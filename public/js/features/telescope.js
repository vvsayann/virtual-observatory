window.Telescope = {
    init: function(observatory) {
        this.observatory = observatory;
        this.enabled = false;
        this.magnification = 50;

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
        const panel = document.createElement('div');
        panel.className = 'telescope-panel';
        panel.innerHTML = `
            <h3>Eyepiece</h3>
            <label><input type="checkbox" id="tele-enable"> Enable</label><br>
            <label>Mag: <select id="tele-mag">
                <option value="25">25x</option>
                <option value="50" selected>50x</option>
                <option value="100">100x</option>
                <option value="200">200x</option>
            </select></label>
        `;

        this.observatory.registerPanel(panel);

        document.getElementById('tele-enable').addEventListener('change', (e) => {
            this.enabled = e.target.checked;
            this.updateView();
        });

        document.getElementById('tele-mag').addEventListener('change', (e) => {
            this.magnification = parseInt(e.target.value, 10);
            this.updateView();
        });

        const style = document.createElement('style');
        style.textContent = `
            .eyepiece-overlay {
                position: absolute; top: 0; left: 0; width: 100%; height: 100%;
                pointer-events: none;
                background: radial-gradient(circle at center, transparent 30%, black 30.5%);
                z-index: 2; display: none;
            }
        `;
        document.head.appendChild(style);

        this.overlay = document.createElement('div');
        this.overlay.className = 'eyepiece-overlay';
        const appEl = document.querySelector('.app') || document.body;
        appEl.appendChild(this.overlay);
    },

    updateView: function() {
        if (this.enabled) {
            if (this.previousFov == null) {
                this.previousFov = (this.observatory.state && this.observatory.state.fov) || 60;
            }
            this.overlay.style.display = 'block';
            const newFov = 60 / (this.magnification / 10);
            if (this.observatory.setFov) {
                this.observatory.setFov(newFov);
            }
        } else {
            this.overlay.style.display = 'none';
            if (this.observatory.setFov) {
                this.observatory.setFov(this.previousFov != null ? this.previousFov : 60);
            }
            this.previousFov = null;
        }
    }
};

if (window.Observatory) {
    window.Telescope.init(window.Observatory);
}