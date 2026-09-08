/**
 * js/features/tours.js
 * Guided tours / "What's up tonight"
 */

window.Tours = {
    init: function(observatory) {
        this.observatory = observatory;
        
        if (this.observatory && typeof this.observatory.registerPanel === 'function') {
            this.setupUI();
        } else {
            const checkInterval = setInterval(() => {
                if (window.Observatory && typeof window.Observatory.registerPanel === 'function') {
                    this.observatory = window.Observatory;
                    this.setupUI();
                    clearInterval(checkInterval);
                }
            }, 500);
        }
    },

    setupUI: function() {
        this.panel = document.createElement('div');
        this.panel.className = 'tours-panel';
        this.panel.innerHTML = `<h3>What's Up Tonight</h3><div id="tours-content">Loading...</div>`;
        this.observatory.registerPanel(this.panel);
        
        this.updateContent();
        if (this.observatory.on) {
            this.observatory.on('tick', () => {
                if (!this.lastUpdate || Date.now() - this.lastUpdate > 60000) {
                    this.updateContent();
                }
            });
        }
    },

    updateContent: function() {
        this.lastUpdate = Date.now();
        const date = this.observatory.state ? this.observatory.state.date : new Date();
        const loc = this.observatory.state ? this.observatory.state.location : {lat: 0, lon: 0};
        
        let html = `<h4>Planets</h4><ul>`;
        
        if (window.Astro) {
            const bodies = Astro.bodies(date);
            const jd = Astro.julianDate(date);
            const lst = Astro.lst(jd, loc.lon);
            
            bodies.forEach(b => {
                const horiz = Astro.equatorialToHorizontal(b.ra, b.dec, loc.lat, lst);
                if (horiz.alt > 0) {
                    html += `<li><a href="#" class="tour-fly" data-ra="${b.ra}" data-dec="${b.dec}">${b.name}</a> (Alt: ${Math.round(horiz.alt)}°)</li>`;
                }
            });
            
            if (html === `<h4>Planets</h4><ul>`) html += `<li>None visible</li>`;
            html += `</ul>`;
            
            html += `<h4>Deep Sky Objects</h4><ul>`;
            if (window.DSO_DATA) {
                const visibleDSOs = window.DSO_DATA.map(dso => {
                    const horiz = Astro.equatorialToHorizontal(dso[1], dso[2], loc.lat, lst);
                    return { name: dso[0], common: dso[5], ra: dso[1], dec: dso[2], alt: horiz.alt, mag: dso[3] };
                }).filter(dso => dso.alt > 10).sort((a, b) => a.mag - b.mag).slice(0, 3);
                
                visibleDSOs.forEach(dso => {
                    const name = dso.common || dso.name;
                    html += `<li><a href="#" class="tour-fly" data-ra="${dso.ra}" data-dec="${dso.dec}">${name}</a> (Mag: ${dso.mag})</li>`;
                });
            } else {
                html += `<li>DSO data not loaded</li>`;
            }
            html += `</ul>`;
        } else {
            html = `<p>Astro engine not loaded.</p>`;
        }
        
        const contentDiv = this.panel.querySelector('#tours-content');
        if (contentDiv) {
            contentDiv.innerHTML = html;
            
            const links = contentDiv.querySelectorAll('.tour-fly');
            links.forEach(link => {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    const ra = parseFloat(e.target.dataset.ra);
                    const dec = parseFloat(e.target.dataset.dec);
                    if (window.Astro && this.observatory.state) {
                        const jd = Astro.julianDate(this.observatory.state.date);
                        const lst = Astro.lst(jd, this.observatory.state.location.lon);
                        const horiz = Astro.equatorialToHorizontal(ra, dec, this.observatory.state.location.lat, lst);
                        if (this.observatory.lookAt) {
                            this.observatory.lookAt(horiz.alt, horiz.az);
                        }
                    }
                });
            });
        }
    }
};

if (window.Observatory) {
    window.Tours.init(window.Observatory);
}
