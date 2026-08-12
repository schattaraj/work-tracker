(function () {
  'use strict';
  const form = document.getElementById('registerForm');
  const alertEl = document.getElementById('registerAlert');
  const btn = document.getElementById('registerSubmitBtn');
  const successEl = document.getElementById('registerSuccess');
  const loginLink = document.getElementById('registerLoginLink');

  function showError(msg) {
    alertEl.textContent = msg;
    alertEl.classList.remove('d-none');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    alertEl.classList.add('d-none');

    const password = document.getElementById('registerPassword').value;
    const confirm = document.getElementById('registerConfirm').value;
    if (password.length < 8) { showError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { showError('Passwords do not match.'); return; }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Creating account…';
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: document.getElementById('registerName').value,
          email: document.getElementById('registerEmail').value,
          password
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError(data.error || 'Registration failed.');
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-person-plus me-1"></i>Create Account';
        return;
      }
      form.classList.add('d-none');
      loginLink.classList.add('d-none');
      successEl.classList.remove('d-none');
    } catch (err) {
      showError('Network error — please try again.');
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-person-plus me-1"></i>Create Account';
    }
  });
})();
