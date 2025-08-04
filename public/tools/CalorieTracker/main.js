/**
 * @file src/main.js - DEBUG VERSION
 * @description Main application entry point with extensive debugging
 */

// ===== DEBUGGING CONFIGURATION =====
const DEBUG_MODE = true;
const SHOW_ALL_ERRORS = true;

function debugLog(step, message, data = null) {
  if (DEBUG_MODE) {
    console.log(`🔍 [DEBUG][${step}]`, message, data || '');
  }
}

function errorLog(step, error, context = '') {
  console.error(`❌ [ERROR][${step}]`, context, error);
  
  // Show error on screen if possible
  try {
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
      position: fixed; top: 10px; left: 10px; right: 10px; 
      background: red; color: white; padding: 10px; 
      border-radius: 5px; z-index: 9999; font-family: monospace;
    `;
    errorDiv.innerHTML = `<strong>ERROR in ${step}:</strong><br>${context}<br>${error.message || error}`;
    document.body.appendChild(errorDiv);
  } catch (e) {
    console.error('Could not show error on screen:', e);
  }
}

// ===== STEP 1: TEST BASIC DOM ACCESS =====
debugLog('INIT', 'Starting application initialization');

try {
  debugLog('DOM-TEST', 'Testing basic DOM access');
  const testDiv = document.createElement('div');
  debugLog('DOM-TEST', '✅ Basic DOM access works');
} catch (error) {
  errorLog('DOM-TEST', error, 'Basic DOM access failed');
}

// ===== STEP 2: TEST MODULE IMPORTS =====
let wireFunction, cacheDomFunction, stateObject;
let showMessageFunction, handleErrorFunction;
let ensureDateInputFunction, loadUserDataFunction;
let authFunctions = {};

try {
  debugLog('IMPORT-TEST', 'Testing module imports...');
  
  // Test each import individually to see which one fails
  Promise.all([
    import('./events/wire.js').then(module => {
      wireFunction = module.wire;
      debugLog('IMPORT-TEST', '✅ wire.js imported successfully');
    }).catch(error => {
      errorLog('IMPORT-WIRE', error, 'Failed to import wire.js');
      throw error;
    }),
    
    import('./state/store.js').then(module => {
      cacheDomFunction = module.cacheDom;
      stateObject = module.state;
      debugLog('IMPORT-TEST', '✅ store.js imported successfully');
    }).catch(error => {
      errorLog('IMPORT-STORE', error, 'Failed to import store.js');
      throw error;
    }),
    
    import('./utils/ui.js').then(module => {
      showMessageFunction = module.showMessage;
      handleErrorFunction = module.handleError;
      debugLog('IMPORT-TEST', '✅ ui.js imported successfully');
    }).catch(error => {
      errorLog('IMPORT-UI', error, 'Failed to import ui.js');
      throw error;
    }),
    
    import('./services/data.js').then(module => {
      ensureDateInputFunction = module.ensureDateInput;
      loadUserDataFunction = module.loadUserData;
      debugLog('IMPORT-TEST', '✅ data.js imported successfully');
    }).catch(error => {
      errorLog('IMPORT-DATA', error, 'Failed to import data.js');
      throw error;
    }),
    
    import('./services/firebase.js').then(module => {
      authFunctions = {
        onAuth: module.onAuth,
        loginGuest: module.loginGuest,
        loginWithCustomToken: module.loginWithCustomToken,
        loginEmail: module.loginEmail,
        signupEmail: module.signupEmail,
        logout: module.logout
      };
      debugLog('IMPORT-TEST', '✅ firebase.js imported successfully');
    }).catch(error => {
      errorLog('IMPORT-FIREBASE', error, 'Failed to import firebase.js');
      throw error;
    }),
    
    import('./ui/dashboard.js').then(module => {
      debugLog('IMPORT-TEST', '✅ dashboard.js imported successfully');
    }).catch(error => {
      errorLog('IMPORT-DASHBOARD', error, 'Failed to import dashboard.js');
      throw error;
    })
    
  ]).then(() => {
    debugLog('IMPORT-TEST', '✅ All modules imported successfully');
    startApp();
  }).catch(error => {
    errorLog('IMPORT-ALL', error, 'Module import failed - app cannot start');
    showFallbackUI('Module loading failed. Check console for details.');
  });
  
} catch (error) {
  errorLog('IMPORT-SETUP', error, 'Failed to set up module imports');
  showFallbackUI('Critical error during startup. Check console for details.');
}

// ===== STEP 3: APPLICATION STARTUP =====
function startApp() {
  debugLog('APP-START', 'Starting application with all modules loaded');
  
  try {
    // Test DOM caching
    debugLog('APP-START', 'Testing DOM caching...');
    cacheDomFunction();
    debugLog('APP-START', '✅ DOM caching successful');
    
    // Test state object
    debugLog('APP-START', 'Testing state object...', Object.keys(stateObject));
    debugLog('APP-START', '✅ State object accessible');
    
    // Test date input
    debugLog('APP-START', 'Testing date input setup...');
    ensureDateInputFunction();
    debugLog('APP-START', '✅ Date input setup successful');
    
    // Test event wiring
    debugLog('APP-START', 'Testing event wiring...');
    wireFunction();
    debugLog('APP-START', '✅ Event wiring successful');
    
    // Show loader
    debugLog('APP-START', 'Setting up UI state...');
    if (stateObject.dom.loader) {
      stateObject.dom.loader.classList.remove('hidden');
      debugLog('APP-START', '✅ Loader shown');
    } else {
      debugLog('APP-START', '⚠️ Loader element not found');
    }
    
    // Set up authentication
    debugLog('APP-START', 'Setting up authentication...');
    setupAuthListener();
    
  } catch (error) {
    errorLog('APP-START', error, 'Application startup failed');
    showFallbackUI('Application startup failed. Check console for details.');
  }
}

// ===== STEP 4: AUTHENTICATION SETUP =====
function setupAuthListener() {
  debugLog('AUTH-SETUP', 'Setting up authentication listener...');
  
  try {
    if (!authFunctions.onAuth) {
      throw new Error('onAuth function not available');
    }
    
    authFunctions.onAuth((user) => {
      debugLog('AUTH-CHANGE', 'Authentication state changed', user ? `User: ${user.uid}` : 'No user');
      
      try {
        if (user) {
          handleUserLoggedIn(user);
        } else {
          handleUserLoggedOut();
        }
      } catch (error) {
        errorLog('AUTH-HANDLER', error, 'Error in auth state handler');
      }
    });
    
    debugLog('AUTH-SETUP', '✅ Authentication listener set up successfully');
    
  } catch (error) {
    errorLog('AUTH-SETUP', error, 'Failed to set up authentication');
    showFallbackUI('Authentication setup failed. Check console for details.');
  }
}

// ===== STEP 5: USER STATE HANDLERS =====
async function handleUserLoggedIn(user) {
  debugLog('AUTH-LOGIN', 'Handling logged in user', user.uid);
  
  try {
    stateObject.userId = user.uid;
    
    // Update UI
    updateUIForLoggedInUser(user);
    
    // Load user data
    debugLog('AUTH-LOGIN', 'Loading user data...');
    await loadUserDataFunction();
    debugLog('AUTH-LOGIN', '✅ User data loaded successfully');
    
  } catch (error) {
    errorLog('AUTH-LOGIN', error, 'Error handling logged in user');
    showFallbackUI('Error loading user data. Check console for details.');
  }
}

async function handleUserLoggedOut() {
  debugLog('AUTH-LOGOUT', 'Handling logged out user');
  
  try {
    updateUIForLoggedOutUser();
    await attemptAutoSignIn();
  } catch (error) {
    errorLog('AUTH-LOGOUT', error, 'Error handling logged out user');
  }
}

// ===== STEP 6: UI UPDATES =====
function updateUIForLoggedInUser(user) {
  debugLog('UI-UPDATE', 'Updating UI for logged in user');
  
  try {
    // Hide login modal and show main content
    if (stateObject.dom.loginModal) {
      stateObject.dom.loginModal.classList.add('hidden');
      debugLog('UI-UPDATE', '✅ Login modal hidden');
    }
    
    if (stateObject.dom.mainContent) {
      stateObject.dom.mainContent.classList.remove('hidden');
      debugLog('UI-UPDATE', '✅ Main content shown');
    }
    
    if (stateObject.dom.loader) {
      stateObject.dom.loader.classList.add('hidden');
      debugLog('UI-UPDATE', '✅ Loader hidden');
    }
    
    // Update buttons
    const openLoginBtn = document.getElementById('open-login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    
    if (openLoginBtn) openLoginBtn.classList.add('hidden');
    if (logoutBtn) logoutBtn.classList.remove('hidden');
    
    // Update user status
    if (stateObject.dom.userStatus) {
      stateObject.dom.userStatus.classList.remove('hidden');
      stateObject.dom.userStatus.textContent = user.isAnonymous 
        ? `Guest (${stateObject.userId.substring(0, 8)}...)`
        : user.email;
    }
    
    debugLog('UI-UPDATE', '✅ UI updated for logged in user');
    
  } catch (error) {
    errorLog('UI-UPDATE', error, 'Failed to update UI for logged in user');
  }
}

function updateUIForLoggedOutUser() {
  debugLog('UI-UPDATE', 'Updating UI for logged out user');
  
  try {
    if (stateObject.dom.mainContent) stateObject.dom.mainContent.classList.add('hidden');
    if (stateObject.dom.loader) stateObject.dom.loader.classList.add('hidden');
    if (stateObject.dom.loginModal) stateObject.dom.loginModal.classList.remove('hidden');
    
    const openLoginBtn = document.getElementById('open-login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    
    if (openLoginBtn) openLoginBtn.classList.remove('hidden');
    if (logoutBtn) logoutBtn.classList.add('hidden');
    
    if (stateObject.dom.userStatus) {
      stateObject.dom.userStatus.classList.add('hidden');
      stateObject.dom.userStatus.textContent = '';
    }
    
    debugLog('UI-UPDATE', '✅ UI updated for logged out user');
    
  } catch (error) {
    errorLog('UI-UPDATE', error, 'Failed to update UI for logged out user');
  }
}

// ===== STEP 7: AUTO SIGN-IN =====
async function attemptAutoSignIn() {
  debugLog('AUTO-SIGNIN', 'Attempting automatic sign in...');
  
  try {
    // Check for custom token
    if (typeof window.__initial_auth_token !== 'undefined' && window.__initial_auth_token) {
      debugLog('AUTO-SIGNIN', 'Trying custom token...');
      try {
        await authFunctions.loginWithCustomToken(window.__initial_auth_token);
        debugLog('AUTO-SIGNIN', '✅ Custom token login successful');
        return;
      } catch (error) {
        debugLog('AUTO-SIGNIN', '⚠️ Custom token failed, trying guest login');
      }
    }
    
    // Fall back to guest login
    debugLog('AUTO-SIGNIN', 'Trying guest login...');
    await authFunctions.loginGuest();
    debugLog('AUTO-SIGNIN', '✅ Guest login successful');
    
  } catch (error) {
    errorLog('AUTO-SIGNIN', error, 'All auto sign-in methods failed');
    stateObject.userId = null;
  }
}

// ===== FALLBACK UI =====
function showFallbackUI(message) {
  debugLog('FALLBACK', 'Showing fallback UI', message);
  
  try {
    // Hide loader
    const loader = document.getElementById('loader');
    if (loader) loader.classList.add('hidden');
    
    // Show error message
    const mainContent = document.getElementById('main-content');
    if (mainContent) {
      mainContent.innerHTML = `
        <div class="flex items-center justify-center min-h-screen bg-gray-100">
          <div class="bg-white p-8 rounded-lg shadow-lg max-w-md">
            <h2 class="text-xl font-bold text-red-600 mb-4">⚠️ Application Error</h2>
            <p class="text-gray-700 mb-4">${message}</p>
            <p class="text-sm text-gray-500">Check the browser console (F12) for technical details.</p>
            <button onclick="location.reload()" class="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
              Reload Page
            </button>
          </div>
        </div>
      `;
      mainContent.classList.remove('hidden');
    }
  } catch (error) {
    console.error('Could not show fallback UI:', error);
  }
}

// ===== AUTH BUTTON HANDLERS (for wire.js) =====
export async function handleLogin() {
  debugLog('AUTH-HANDLER', 'Handling login button click');
  
  const email = document.getElementById('email-input')?.value.trim();
  const password = document.getElementById('password-input')?.value;
  
  if (!email || !password) {
    showMessageFunction?.('Please enter both email and password.', true);
    return;
  }
  
  try {
    await authFunctions.loginEmail(email, password);
    showMessageFunction?.('Logged in successfully!');
  } catch (e) {
    errorLog('AUTH-LOGIN', e, 'Login failed');
    const message = ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found'].includes(e.code)
      ? 'Incorrect email or password.'
      : e.message;
    showMessageFunction?.(message, true);
  }
}

export async function handleSignUp() {
  debugLog('AUTH-HANDLER', 'Handling signup button click');
  
  const email = document.getElementById('email-input')?.value.trim();
  const password = document.getElementById('password-input')?.value;
  
  if (!email || !password) {
    showMessageFunction?.('Please enter both email and password.', true);
    return;
  }
  
  if (password.length < 6) {
    showMessageFunction?.('Password should be at least 6 characters long.', true);
    return;
  }
  
  try {
    await authFunctions.signupEmail(email, password);
    showMessageFunction?.('Account created successfully!');
  } catch (e) {
    errorLog('AUTH-SIGNUP', e, 'Signup failed');
    const message = e.code === 'auth/email-already-in-use'
      ? 'Email already in use.'
      : e.message;
    showMessageFunction?.(message, true);
  }
}

export async function handleGuestLogin() {
  debugLog('AUTH-HANDLER', 'Handling guest login button click');
  
  try {
    await authFunctions.loginGuest();
    showMessageFunction?.('Continuing as guest.');
  } catch (e) {
    errorLog('AUTH-GUEST', e, 'Guest login failed');
    showMessageFunction?.('Could not sign in as guest.', true);
  }
}

export async function handleLogout() {
  debugLog('AUTH-HANDLER', 'Handling logout button click');
  
  try {
    await authFunctions.logout();
    
    // Reset state
    stateObject.userId = null;
    stateObject.baselineTargets = {};
    stateObject.dailyEntries.clear();
    stateObject.dailyFoodItems = [];
    stateObject.savedFoodItems.clear();
    
    if (stateObject.chartInstance) {
      stateObject.chartInstance.destroy();
      stateObject.chartInstance = null;
    }
    
    showMessageFunction?.('Logged out successfully.');
    
  } catch (e) {
    errorLog('AUTH-LOGOUT', e, 'Logout failed');
    showMessageFunction?.('Failed to log out.', true);
  }
}

// ===== INITIALIZE WHEN DOM READY =====
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    debugLog('INIT', 'DOM loaded, starting app');
  });
} else {
  debugLog('INIT', 'DOM already ready, starting app immediately');
}