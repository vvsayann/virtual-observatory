import puppeteer from 'puppeteer-core';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
await page.goto('http://localhost:4317/', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 1500));
// Move to a clear-sky night: Mauna Kea, look up toward the Milky Way region
await page.evaluate(() => {
  const O = window.Observatory;
  O.setLocation(19.82, -155.47, 'Mauna Kea, HI');
  O.setTime(new Date(Date.UTC(2026, 6, 22, 9, 0, 0))); // 23:00 local HST -> deep night
  O.state.playing = false;
  O.state.center = { alt: 45, az: 150 };
  O.state.fov = 100;
  O.state.layers.grid = false;
});
await new Promise(r => setTimeout(r, 1500));
await page.screenshot({ path: 'tools/shot_night.png' });
const lit = await page.evaluate(() => {
  const c = document.getElementById('sky'), g = c.getContext('2d');
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let nb = 0, s = 0; for (let i = 0; i < d.length; i += 4000) { s++; if (d[i] + d[i+1] + d[i+2] > 40) nb++; }
  return { litFraction: (nb / s).toFixed(3), sun: window.Observatory.state.bodies[0].altaz.alt.toFixed(0) };
});
console.log(JSON.stringify(lit));
await browser.close();
