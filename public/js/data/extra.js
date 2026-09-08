/**
 * js/data/extra.js
 * 
 * Extended catalogs for the Virtual Observatory.
 * 
 * window.EXTRA_DATA formats:
 * - meteorShowers: [{name: string, peak: string, raDeg: number, decDeg: number, zhr: number}, ...]
 * - brightComets: [{name: string, raDeg: number, decDeg: number, mag: number}, ...]
 * - asterisms: { "Asterism Name": [ [[raDeg, decDeg], ...polyline], ... ] }
 * - milkyWay: [ [[raDeg, decDeg], ...polygon], ... ]
 */

window.EXTRA_DATA = {
    meteorShowers: [
        { name: "Quadrantids", peak: "Jan 3", raDeg: 230, decDeg: 49, zhr: 110 },
        { name: "Lyrids", peak: "Apr 22", raDeg: 271, decDeg: 34, zhr: 18 },
        { name: "Eta Aquariids", peak: "May 6", raDeg: 338, decDeg: -1, zhr: 50 },
        { name: "Delta Aquariids", peak: "Jul 30", raDeg: 340, decDeg: -16, zhr: 20 },
        { name: "Perseids", peak: "Aug 12", raDeg: 48, decDeg: 58, zhr: 100 },
        { name: "Orionids", peak: "Oct 21", raDeg: 95, decDeg: 16, zhr: 20 },
        { name: "Leonids", peak: "Nov 17", raDeg: 153, decDeg: 22, zhr: 15 },
        { name: "Geminids", peak: "Dec 14", raDeg: 112, decDeg: 33, zhr: 150 },
        { name: "Ursids", peak: "Dec 22", raDeg: 217, decDeg: 76, zhr: 10 }
    ],
    brightComets: [], // Placeholder for live comets
    asterisms: {
        "Big Dipper": [
            [ [165.46, 61.75], [164.46, 56.38], [178.46, 53.69], [183.86, 57.03], [165.46, 61.75] ],
            [ [165.46, 61.75], [193.56, 55.96], [200.98, 54.92], [206.88, 49.31] ]
        ],
        "Summer Triangle": [
            [ [279.23, 38.78], [297.69, 8.86], [310.35, 45.28], [279.23, 38.78] ]
        ]
    },
    milkyWay: [
        [
            [0, -30], [30, -10], [60, 20], [90, 40], [120, 50], [150, 40], [180, 20],
            [210, -10], [240, -40], [270, -60], [300, -70], [330, -50], [360, -30]
        ]
    ]
};
