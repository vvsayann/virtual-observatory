import puppeteer from 'puppeteer-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.argv[2] || 'http://localhost:4317/';
const OUT = process.argv[3] || 'shot.png';

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1400,900']
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
// let a few animation frames run so the sky draws
await new Promise(r => setTimeout(r, 2500));

// report canvas non-blankness + a few HUD facts
const info = await page.evaluate(() => {
  const c = document.getElementById('sky');
  const g = c.getContext('2d');
  const { width, height } = c;
  const data = g.getImageData(0, 0, width, height).data;
  let nonBlack = 0, samples = 0;
  for (let i = 0; i < data.length; i += 4000) { samples++; if (data[i] + data[i + 1] + data[i + 2] > 30) nonBlack++; }
  const st = window.Observatory && window.Observatory.state;
  return {
    canvas: `${width}x${height}`,
    litFraction: (nonBlack / samples).toFixed(3),
    bodies: st ? st.bodies.map(b => `${b.name} alt=${b.altaz ? b.altaz.alt.toFixed(0) : '?'}`) : null,
    hud: st ? st.hud.utc : null,
    hasTelescope: !!window.Telescope, hasTours: !!window.Tours, hasExtra: !!window.EXTRA_DATA
  };
});
console.log(JSON.stringify(info, null, 2));
if (errors.length) console.log('\n--- page errors ---\n' + errors.join('\n'));

await page.screenshot({ path: OUT });
console.log('saved', OUT);
await browser.close();
