// Landing page: welcome & featured content
Pages.landing = () => {
  const page = document.getElementById('page');
  page.innerHTML = `
    <div class="landing">
      <div class="landing-hero">
        <div class="hero-content">
          <h1>Smart Tower Monitoring</h1>
          <p class="hero-subtitle">Infrastructure Intelligence Platform</p>
          <p class="hero-description">Real-time monitoring, predictive maintenance, and intelligent infrastructure management for telecom towers and beyond.</p>
          <div class="hero-cta">
            <button id="get-started-btn" class="btn primary">Get Started</button>
          </div>
        </div>
      </div>

      <!-- Hidden initially; revealed when user clicks Get Started -->
      <div class="landing-features">
        <div class="features-grid">
          <div class="feature-card">
            <div class="feature-icon">📡</div>
            <h3>Real-Time Monitoring</h3>
            <p>Live telemetry and status updates from all your infrastructure sites with instant alerts.</p>
          </div>
          <div class="feature-card">
            <div class="feature-icon">⚡</div>
            <h3>Power Management</h3>
            <p>Grid, solar, and generator monitoring with automatic switching and utilization reports.</p>
          </div>
          <div class="feature-card">
            <div class="feature-icon">🔧</div>
            <h3>Predictive Maintenance</h3>
            <p>AI-powered trend analysis for generators, fuel efficiency, and equipment health prediction.</p>
          </div>
          <div class="feature-card">
            <div class="feature-icon">🎥</div>
            <h3>Security & CCTV</h3>
            <p>Real-time motion detection using your phone's camera as a live CCTV node.</p>
          </div>
          <div class="feature-card">
            <div class="feature-icon">📊</div>
            <h3>SLA & Reporting</h3>
            <p>Comprehensive dashboards, SLA tracking, and exportable analytics for decision making.</p>
          </div>
          <div class="feature-card">
            <div class="feature-icon">🏢</div>
            <h3>Tenancy Intelligence</h3>
            <p>Commercial insights including occupancy ratios and revenue opportunity identification.</p>
          </div>
        </div>
      </div>

      <div class="landing-stats">
        <div class="stats-grid">
          <div class="stat">
            <div class="stat-value">Zero</div>
            <div class="stat-label">External Dependencies</div>
          </div>
          <div class="stat">
            <div class="stat-value">Real-Time</div>
            <div class="stat-label">WebSocket Updates</div>
          </div>
          <div class="stat">
            <div class="stat-value">End-to-End</div>
            <div class="stat-label">Encrypted</div>
          </div>
        </div>
      </div>

      <div class="landing-cta">
        <h2>Ready to get started?</h2>
        <p>Log in to your account or contact us for a demo.</p>
        <button id="login-cta-btn" class="btn primary" onclick="window.location.hash='#/login'">Log In</button>
      </div>
    </div>
  `;

  // Attach reveal behavior: show the features + CTA when Get Started is clicked
  const startBtn = document.getElementById('get-started-btn');
  if (startBtn) {
    startBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const features = document.querySelector('.landing-features');
      const cta = document.querySelector('.landing-cta');
      if (features) {
        features.classList.add('revealed');
      }
      if (cta) {
        cta.classList.add('revealed');
      }
      const hero = document.querySelector('.landing-hero');
      if (hero) {
        hero.classList.add('hidden-hero');
      }
      const landingEl = document.querySelector('.landing');
      if (landingEl) landingEl.classList.add('compact');
      // small delay then focus and smooth-scroll to features
      setTimeout(() => {
        if (features) features.scrollIntoView({ behavior: 'smooth' });
      }, 80);
    });
  }
};
