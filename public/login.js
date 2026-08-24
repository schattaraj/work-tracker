(function () {
  'use strict';
  const form = document.getElementById('loginForm');
  const alertEl = document.getElementById('loginAlert');
  const btn = document.getElementById('loginSubmitBtn');

  function showError(msg) {
    alertEl.textContent = msg;
    alertEl.classList.remove('d-none');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    alertEl.classList.add('d-none');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Signing in…';
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: document.getElementById('loginEmail').value,
          password: document.getElementById('loginPassword').value
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError(data.error || 'Sign in failed.');
        return;
      }
      window.location.href = '/app.html';
    } catch (err) {
      showError('Network error — please try again.');
    } finally {
      // Always restore the button — on error OR success — so a failed
      // attempt (wrong password, pending account, network blip) never
      // leaves it stuck disabled/spinning with no way to retry.
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-box-arrow-in-right me-1"></i>Sign In';
    }
  });
})();
