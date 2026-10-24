/**
 * AXIS - Universal Device Router & Detection
 * Detects whether the visitor is on mobile (iPhone, Android, tablet) or desktop (PC, Mac)
 * and automatically routes them to the appropriate version while respecting manual overrides.
 */
(function() {
    // 1. Process explicit URL parameter override (?view=desktop or ?view=mobile)
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const viewParam = urlParams.get('view');
        if (viewParam === 'desktop' || viewParam === 'mobile') {
            sessionStorage.setItem('axis_device_preference', viewParam);
            // Clean URL query parameter without triggering page reload
            const cleanUrl = window.location.pathname + window.location.hash;
            window.history.replaceState({}, document.title, cleanUrl);
        }
    } catch(e) {}

    /**
     * Determines whether the current device is considered mobile.
     * Respects manual user selection saved in sessionStorage.
     */
    window.isMobileDevice = function() {
        const savedPref = sessionStorage.getItem('axis_device_preference');
        if (savedPref === 'desktop') return false;
        if (savedPref === 'mobile') return true;

        const ua = navigator.userAgent || navigator.vendor || window.opera || '';
        const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i;
        const isMobileUA = mobileRegex.test(ua);
        const isSmallScreen = window.innerWidth <= 768;
        const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

        return isMobileUA || (isSmallScreen && hasTouch);
    };

    /**
     * Sets manual device preference and redirects to the chosen version.
     */
    window.setDevicePreference = function(pref, targetUrl) {
        if (pref) {
            sessionStorage.setItem('axis_device_preference', pref);
        }
        if (targetUrl) {
            window.location.href = targetUrl;
        }
    };

    /**
     * Automatically routes the user based on device and page context.
     * @param {'landing' | 'desktop-login' | 'desktop-app' | 'mobile-login' | 'mobile-app'} pageType
     */
    window.routeDevice = function(pageType) {
        const isMobile = window.isMobileDevice();

        switch(pageType) {
            case 'landing':
                if (isMobile) {
                    window.location.replace('mobile/login.html');
                }
                break;

            case 'desktop-login':
                if (isMobile) {
                    window.location.replace('../mobile/login.html');
                }
                break;

            case 'desktop-app':
                if (isMobile) {
                    window.location.replace('../mobile/index.html');
                }
                break;

            case 'mobile-login':
                if (!isMobile && sessionStorage.getItem('axis_device_preference') === 'desktop') {
                    window.location.replace('../pages/login.html');
                }
                break;

            case 'mobile-app':
                if (!isMobile && sessionStorage.getItem('axis_device_preference') === 'desktop') {
                    window.location.replace('../pages/app.html');
                }
                break;
        }
    };
})();
