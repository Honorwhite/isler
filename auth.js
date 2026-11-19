// Jasmin Digital - Pure Supabase Auth Module (JWT + RLS, Zero Fallback Passwords)
(function () {
    const ADMIN_EMAIL = 'admin@jasmindigital.com';

    const MODE_KEY = 'jasmin_auth_mode';
    const TAB_SESSION_KEY = 'jasmin_auth_tab_active';
    const LOCKOUT_KEY = 'jasmin_auth_lockout_v2';
    const MAX_ATTEMPTS = 5;
    const LOCKOUT_MS = 30 * 1000;

    function getLockoutState() {
        try {
            const raw = localStorage.getItem(LOCKOUT_KEY);
            return raw ? JSON.parse(raw) : { attempts: 0, until: 0 };
        } catch {
            return { attempts: 0, until: 0 };
        }
    }

    function setLockoutState(state) {
        try {
            localStorage.setItem(LOCKOUT_KEY, JSON.stringify(state));
        } catch {
            // ignore
        }
    }

    function clearLockout() {
        try {
            localStorage.removeItem(LOCKOUT_KEY);
        } catch {
            // ignore
        }
    }

    async function isAuthenticated() {
        if (!window.sb || !window.sb.auth) return false;

        // If user unchecked "Remember me", expire session once tab closes
        try {
            const mode = localStorage.getItem(MODE_KEY);
            if (mode === 'session' && !sessionStorage.getItem(TAB_SESSION_KEY)) {
                await logout();
                return false;
            }
        } catch {
            // ignore
        }

        try {
            const { data, error } = await window.sb.auth.getSession();
            return Boolean(!error && data && data.session);
        } catch {
            return false;
        }
    }

    async function login(password, remember = true) {
        const lock = getLockoutState();
        if (lock.until && lock.until > Date.now()) {
            const secs = Math.ceil((lock.until - Date.now()) / 1000);
            return { ok: false, error: `Çok fazla hatalı deneme. ${secs} saniye bekleyin.` };
        }

        const cleanPass = String(password || '');
        if (!cleanPass) {
            return { ok: false, error: 'Lütfen şifrenizi girin.' };
        }

        if (!window.sb || !window.sb.auth) {
            return { ok: false, error: 'Kimlik doğrulama servisi yüklenemedi.' };
        }

        try {
            const { data, error } = await window.sb.auth.signInWithPassword({
                email: ADMIN_EMAIL,
                password: cleanPass
            });

            if (!error && data && data.session) {
                clearLockout();
                try {
                    if (remember) {
                        localStorage.setItem(MODE_KEY, 'persistent');
                        sessionStorage.removeItem(TAB_SESSION_KEY);
                    } else {
                        localStorage.setItem(MODE_KEY, 'session');
                        sessionStorage.setItem(TAB_SESSION_KEY, '1');
                    }
                    // Clean up any legacy keys
                    localStorage.removeItem('jasmin_auth_session_v2');
                    sessionStorage.removeItem('jasmin_auth_session_v2');
                    sessionStorage.removeItem('isler_admin_auth');
                } catch {
                    // ignore
                }
                return { ok: true };
            }
        } catch (err) {
            console.error('Auth error:', err);
        }

        const nextAttempts = (lock.attempts || 0) + 1;
        if (nextAttempts >= MAX_ATTEMPTS) {
            setLockoutState({ attempts: 0, until: Date.now() + LOCKOUT_MS });
            return { ok: false, error: 'Çok fazla hatalı deneme. 30 saniye kilitlendi.' };
        }

        setLockoutState({ attempts: nextAttempts, until: 0 });
        return {
            ok: false,
            error: `Hatalı şifre. (${MAX_ATTEMPTS - nextAttempts} deneme hakkı kaldı)`
        };
    }

    async function logout() {
        try {
            localStorage.removeItem(MODE_KEY);
            localStorage.removeItem('jasmin_auth_session_v2');
            sessionStorage.removeItem(TAB_SESSION_KEY);
            sessionStorage.removeItem('jasmin_auth_session_v2');
            sessionStorage.removeItem('isler_admin_auth');
        } catch {
            // ignore
        }
        if (window.sb && window.sb.auth) {
            try {
                await window.sb.auth.signOut();
            } catch {
                // ignore
            }
        }
    }

    // Modern Password Modal (used by index.html Vault tab)
    let pendingCallback = null;

    function ensureModal() {
        if (document.getElementById('jasmin-auth-modal')) return;

        const overlay = document.createElement('div');
        overlay.id = 'jasmin-auth-modal';
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content auth-modal-card">
                <div class="auth-modal-icon">
                    <i data-lucide="shield-check"></i>
                </div>
                <h2>Şifreler Alanı</h2>
                <p class="auth-modal-sub">Devam etmek için erişim şifresini girin.</p>
                <form id="jasmin-auth-form">
                    <div class="auth-input-wrap">
                        <input
                            type="password"
                            id="jasmin-auth-input"
                            placeholder="Şifre"
                            autocomplete="current-password"
                            required
                        />
                        <button type="button" class="auth-eye-btn" id="jasmin-auth-eye" title="Göster/Gizle">
                            <i data-lucide="eye"></i>
                        </button>
                    </div>
                    <label class="auth-remember-row">
                        <input type="checkbox" id="jasmin-auth-remember" checked />
                        <span>Beni hatırla (bu cihazda tekrar sorma)</span>
                    </label>
                    <p id="jasmin-auth-error" class="auth-error-msg" style="display:none;"></p>
                    <div class="modal-actions auth-modal-actions">
                        <button type="button" class="btn-cancel" id="jasmin-auth-cancel">Vazgeç</button>
                        <button type="submit" class="btn-save" id="jasmin-auth-submit">Giriş Yap</button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(overlay);

        const form = overlay.querySelector('#jasmin-auth-form');
        const input = overlay.querySelector('#jasmin-auth-input');
        const eyeBtn = overlay.querySelector('#jasmin-auth-eye');
        const rememberEl = overlay.querySelector('#jasmin-auth-remember');
        const errorEl = overlay.querySelector('#jasmin-auth-error');
        const cancelBtn = overlay.querySelector('#jasmin-auth-cancel');
        const submitBtn = overlay.querySelector('#jasmin-auth-submit');

        eyeBtn.addEventListener('click', () => {
            const isHidden = input.type === 'password';
            input.type = isHidden ? 'text' : 'password';
            eyeBtn.innerHTML = `<i data-lucide="${isHidden ? 'eye-off' : 'eye'}"></i>`;
            if (typeof lucide !== 'undefined') lucide.createIcons();
            input.focus();
        });

        cancelBtn.addEventListener('click', closeLoginModal);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeLoginModal();
        });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            errorEl.style.display = 'none';
            submitBtn.disabled = true;
            submitBtn.textContent = 'Kontrol ediliyor...';

            const res = await login(input.value, rememberEl.checked);
            submitBtn.disabled = false;
            submitBtn.textContent = 'Giriş Yap';

            if (res.ok) {
                const cb = pendingCallback;
                closeLoginModal();
                if (typeof cb === 'function') cb();
            } else {
                errorEl.textContent = res.error;
                errorEl.style.display = 'block';
                input.value = '';
                input.focus();
            }
        });

        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    function openLoginModal(onSuccess) {
        ensureModal();
        pendingCallback = onSuccess;
        const overlay = document.getElementById('jasmin-auth-modal');
        const input = document.getElementById('jasmin-auth-input');
        const errorEl = document.getElementById('jasmin-auth-error');

        input.value = '';
        input.type = 'password';
        errorEl.style.display = 'none';
        overlay.classList.add('active');
        setTimeout(() => input.focus(), 60);
    }

    function closeLoginModal() {
        const overlay = document.getElementById('jasmin-auth-modal');
        if (overlay) overlay.classList.remove('active');
        pendingCallback = null;
    }

    window.JasminAuth = {
        isAuthenticated,
        login,
        logout,
        openLoginModal,
        closeLoginModal
    };
})();
