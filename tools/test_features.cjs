// A simple test runner for client-side scripts using basic DOM mocks

function assert(condition, message) {
    if (!condition) {
        console.error(`FAIL: ${message}`);
        process.exitCode = 1;
    } else {
        console.log(`PASS: ${message}`);
    }
}

console.log('--- Features Regression Tests ---\n');

// 1. Mocking the browser environment
global.window = {};
global.document = {
    createElement: function(tag) {
        return {
            tagName: tag.toUpperCase(),
            className: '',
            innerHTML: '',
            style: {},
            textContent: '',
            addEventListener: function() {},
            querySelector: function(s) { 
                if (s === '#tours-content') {
                    // return a mock div for content
                    return { 
                        innerHTML: '', 
                        querySelectorAll: () => [] 
                    };
                }
                return null; 
            },
            querySelectorAll: function() { return []; },
            appendChild: function() {}
        };
    },
    getElementById: function() {
        return { addEventListener: function() {}, checked: false, value: "50" };
    },
    head: { appendChild: function() {} },
    body: { appendChild: function() {} }
};

// Map global document and window so scripts see them correctly
global.window.document = global.document;
// Expose functions globally that scripts might expect to be on globalThis
global.document = global.window.document;

// Mock Astro engine for tours.js
global.window.Astro = {
    julianDate: () => 2451545.0,
    lst: () => 0,
    equatorialToHorizontal: () => ({alt: 45, az: 180}),
    bodies: () => [{name: 'Mars', ra: 10, dec: 20}]
};
global.window.DSO_DATA = [
    ['M1', 83.6, 22.0, 8.4, 'snr', 'Crab Nebula']
];

// Mock Observatory
let panelsRegistered = 0;
let lastFov = null;
global.window.Observatory = {
    state: {
        date: new Date(),
        location: {lat: 0, lon: 0}
    },
    registerPanel: function(panel) {
        panelsRegistered++;
    },
    on: function() {},
    setFov: function(fov) {
        lastFov = fov;
    }
};

// Provide setTimeout/setInterval to window
global.window.setInterval = setInterval;
global.window.clearInterval = clearInterval;
global.window.setTimeout = setTimeout;
global.window.clearTimeout = clearTimeout;

// 2. Load the scripts (evaling to keep them in global scope properly)
const fs = require('fs');
const path = require('path');

const extraPath = path.join(__dirname, '../public/js/data/extra.js');
const telePath = path.join(__dirname, '../public/js/features/telescope.js');
const toursPath = path.join(__dirname, '../public/js/features/tours.js');

function loadScript(filePath) {
    const src = fs.readFileSync(filePath, 'utf8');
    // Using Function wrapper to execute in context of global.window
    const fn = new Function('window', 'document', 'Astro', src);
    fn(global.window, global.document, global.window.Astro);
}

loadScript(extraPath);
loadScript(telePath);
loadScript(toursPath);

// Wait briefly for intervals to settle, though we mocked it so they execute immediately if observatory exists
setTimeout(() => {
    // 3. Test EXTRA_DATA
    assert(global.window.EXTRA_DATA, 'EXTRA_DATA was defined');
    assert(global.window.EXTRA_DATA.meteorShowers.length > 0, 'EXTRA_DATA has meteor showers');
    assert(global.window.EXTRA_DATA.asterisms['Big Dipper'], 'EXTRA_DATA has Big Dipper');

    // 4. Test Telescope
    assert(global.window.Telescope, 'Telescope was defined');
    assert(panelsRegistered === 2, `Expected 2 panels registered (tele + tours), got ${panelsRegistered}`);
    
    global.window.Telescope.enabled = true;
    global.window.Telescope.magnification = 100;
    global.window.Telescope.updateView();
    assert(lastFov === 6, `Expected FOV 6 for mag 100x, got ${lastFov}`);
    
    global.window.Telescope.enabled = false;
    global.window.Telescope.updateView();
    assert(lastFov === 60, `Expected FOV 60 when disabled, got ${lastFov}`);

    // 5. Test Tours
    assert(global.window.Tours, 'Tours was defined');
    
    // Simulate tick to force updateContent
    global.window.Tours.updateContent();
    
    console.log('\nAll tests completed.');
}, 100);
