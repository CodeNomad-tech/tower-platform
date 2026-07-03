// Login / register page.
var Pages = window.Pages = window.Pages || {};

Pages.login = function () {
  document.getElementById('root').innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <h1>Smart Tower Platform</h1>
        <p>Sign in to access the operations dashboard</p>
        <form id="login-form">
          <div class="field">
            <label>Email</label>
            <input type="email" id="email" value="admin@towerplatform.demo" required />
          </div>
          <div class="field">
            <label>Password</label>
            <input type="password" id="password" value="ChangeMe123!" required />
          </div>
          <button class="btn primary" style="width:100%; padding:10px;" type="submit">Sign in</button>
          <div class="error-text" id="login-error"></div>
        </form>
        <div class="hint">
          Demo credentials are pre-filled. In production, remove the default admin account
          (see docs/DEPLOYMENT.md) and require registered accounts per operator.
        </div>
      </div>
    </div>`;

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('login-error');
    errorEl.textContent = '';
    try {
      const data = await Api.post('/auth/login', { email, password });
      Api.setToken(data.token);
      window.location.hash = '#/';
      App.render();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
};
