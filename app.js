// Untitled-Faucet v0.0.1

// Edit these:

var config = {
  // Set this to your app's MoneyPot ID. You can see this in your app's
  // MoneyPot URL.
  //
  // For example, https://www.moneypot.com/apps/561-untitled-dice
  // has an ID of 561.
  app_id: 561,
  // On MoneyPot, go to your apps "Edit" page and set the
  // Recaptcha SecretKey there. The SiteKey goes here.
  recaptcha_sitekey: '6LfI_QUTAAAAACrjjuzmLw0Cjx9uABxb8uguLbph',
  // Set this to the URL where you're hosting this script.
  redirect_uri: 'https://untitled-dice.github.io/untitled-faucet'
};

////////////////////////////////////////////////////////////
// Should not have to edit anything below this line
////////////////////////////////////////////////////////////

config.mp_api_uri = 'https://api.moneypot.com';
config.mp_browser_uri = 'https://www.moneypot.com';

if (isRunningLocally()) {
  config.redirect_uri = 'http://localhost:5000'
}

var worldStore = {
  accessToken: undefined,
  claimedAt: localStorage.getItem('claimed_at') && new Date(localStorage.getItem('claimed_at')),
  user: undefined
};

////////////////////////////////////////////////////////////

var helpers = {};

// :: Bool
function isRunningLocally() {
  return /^localhost/.test(window.location.host);
}

helpers.commafy = function(n) {
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

helpers.getPath = function(urlString) {
  var a = document.createElement('a');
  a.href = urlString;
  return a.pathname;
};

// Parses hash params from URL
//
// -> Object
helpers.getHashParams = function() {
  var hashParams = {};
  var e,
      a = /\+/g,  // Regex for replacing addition symbol with a space
      r = /([^&;=]+)=?([^&;]*)/g,
      d = function (s) { return decodeURIComponent(s.replace(a, " ")); },
      q = window.location.hash.substring(1);
  while (e = r.exec(q))
    hashParams[d(e[1])] = d(e[2]);
  return hashParams;
};

/**
 * Decimal adjustment of a number.
 *
 * @param {String}  type  The type of adjustment.
 * @param {Number}  value The number.
 * @param {Integer} exp   The exponent (the 10 logarithm of the adjustment base).
 * @returns {Number} The adjusted value.
 */
helpers.decimalAdjust = function(type, value, exp) {
  // If the exp is undefined or zero...
  if (typeof exp === 'undefined' || +exp === 0) {
    return Math[type](value);
  }
  value = +value;
  exp = +exp;
  // If the value is not a number or the exp is not an integer...
  if (isNaN(value) || !(typeof exp === 'number' && exp % 1 === 0)) {
    return NaN;
  }
  // Shift
  value = value.toString().split('e');
  value = Math[type](+(value[0] + 'e' + (value[1] ? (+value[1] - exp) : -exp)));
  // Shift back
  value = value.toString().split('e');
  return +(value[0] + 'e' + (value[1] ? (+value[1] + exp) : exp));
}

helpers.round10 = function(value, exp) {
  return helpers.decimalAdjust('round', value, exp);
};

helpers.floor10 = function(value, exp) {
  return helpers.decimalAdjust('floor', value, exp);
};

helpers.ceil10 = function(value, exp) {
  return helpers.decimalAdjust('ceil', value, exp);
};

////////////////////////////////////////////////////////////

// Manage access_token //////////////////////////////////////
//
// - If access_token is in url, save it into localStorage.
//   `expires_in` (seconds until expiration) will also exist in url
//   so turn it into a date that we can compare

var access_token, expires_in, expires_at;

if (helpers.getHashParams().access_token) {
  console.log('[token manager] access_token in hash params');
  access_token = helpers.getHashParams().access_token;
  expires_in = helpers.getHashParams().expires_in;
  expires_at = new Date(Date.now() + (expires_in * 1000));

  localStorage.setItem('access_token', access_token);
  localStorage.setItem('expires_at', expires_at);
} else if (localStorage.access_token) {
  console.log('[token manager] access_token in localStorage');
  expires_at = localStorage.expires_at;
  // Only get access_token from localStorage if it expires
  // in a week or more. access_tokens are valid for two weeks
  if (expires_at && new Date(expires_at) > new Date(Date.now() + (1000 * 60 * 60 * 24 * 7))) {
    access_token = localStorage.access_token;
  } else {
    localStorage.removeItem('expires_at');
    localStorage.removeItem('access_token');
  }
} else {
  console.log('[token manager] no access token');
}

// Scrub fragment params from url.
if (window.history && window.history.replaceState) {
  window.history.replaceState({}, document.title, helpers.getPath(config.redirect_uri));
} else {
  // For browsers that don't support html5 history api, just do it the old
  // fashioned way that leaves a trailing '#' in the url
  window.location.hash = '#';
}

worldStore.accessToken = access_token;

////////////////////////////////////////////////////////////

// A weak Moneypot API abstraction
//
// Moneypot's API docs: https://www.moneypot.com/api-docs
var MoneyPot = (function() {

  var o = {};

  o.apiVersion = 'v1';

  // method: 'GET' | 'POST' | ...
  // endpoint: '/tokens/abcd-efgh-...'
  var noop = function() {};
  var makeMPRequest = function(method, bodyParams, endpoint, callbacks, overrideOpts) {

    if (!worldStore.accessToken)
      throw new Error('Must have accessToken set to call MoneyPot API');

    var url = config.mp_api_uri + '/' + o.apiVersion + endpoint;

    if (worldStore.accessToken) {
      url = url + '?access_token=' + worldStore.accessToken;
    }

    var ajaxOpts = {
      url:      url,
      dataType: 'json', // data type of response
      method:   method,
      data:     bodyParams ? JSON.stringify(bodyParams) : undefined,
      // By using text/plain, even though this is a JSON request,
      // we avoid preflight request. (Moneypot explicitly supports this)
      headers: {
        'Content-Type': 'text/plain'
      },
      // Callbacks
      success:  callbacks.success || noop,
      error:    callbacks.error || noop,
      complete: callbacks.complete || noop
    };

    $.ajax(_.merge({}, ajaxOpts, overrideOpts || {}));
  };

  o.getTokenInfo = function(callbacks) {
    console.log('Hitting GET /token');
    var endpoint = '/token';
    makeMPRequest('GET', undefined, endpoint, callbacks);
  };

  // gRecaptchaResponse is string response from google server
  // `callbacks.success` signature	is fn({ claim_id: Int, amoutn: Satoshis })
  o.claimFaucet = function(gRecaptchaResponse, callbacks) {
    console.log('Hitting POST /claim-faucet');
    var endpoint = '/claim-faucet';
    var body = { response: gRecaptchaResponse };
    makeMPRequest('POST', body, endpoint, callbacks);
  };

  return o;
})();

////////////////////////////////////////////////////////////

function render() {

  if (worldStore.user) {
    var html = '';
    html += '<div class="controls"><button type="button" onclick="onWithdrawClick()" class="btn btn-default btn-xs btn-logout">Withdraw</button>';
    html += '<button type="button" onclick="onLogout()" class="btn btn-default btn-xs btn-logout">Logout</button>';
    html += '</div>';
    html += 'Logged in as <code>' + worldStore.user.uname+ '</code> with <code>' + helpers.commafy(helpers.round10(worldStore.user.balance/100, -2)) + '</code> bits' ;
    $('#user-info').html(html);
  } else {
    $('#user-info').empty();
  }

  if (worldStore.user && !worldStore.claimedAt && grecaptcha) {
    // Must empty the div first, else recaptcha will complain
    // when we call grecaptcha.render that it's not empty
    $('#recaptcha-target').empty();

    grecaptcha.render('recaptcha-target', {
      sitekey: config.recaptcha_sitekey,
      callback: onRecaptchaSubmit
    });
  } else if (worldStore.user && !worldStore.claimedAt && !grecaptcha) {
    $('#recaptcha-target').html('Loading ReCaptcha...');
  } else if (worldStore.user && worldStore.claimedAt) {
    var fiveMinutes = 1000*60*5;
    var canClaimAt = new Date(worldStore.claimedAt.getTime() + fiveMinutes);

    var html = '';
    if (worldStore.faucetResult === 'FAUCET_SUCCESS') {
      html += '<span class="label label-success">+2 bits</span> ';
    } else if (worldStore.faucetResult == 'FAUCET_ALREADY_CLAIMED') {
      html += '<span class="label label-danger">Already claimed</span> ';
    } else {
      // display no label prefix
    }
    html += 'You can claim again <abbr class="timeago" title="'+ canClaimAt.toISOString() +'">'+canClaimAt+'</abbr>'
    $('#recaptcha-target').html(html);
    $('.timeago').timeago();
  } else {
    var url = config.mp_browser_uri + '/oauth/authorize?app_id='+config.app_id+'&redirect_uri=' + config.redirect_uri;
    var html = '<a href="'+url+'" class="btn btn-success">Login with MoneyPot</a>';
    var $loginBtn = $(html);
    $('#recaptcha-target').html($loginBtn);
  }
}

function onRecaptchaLoad() {
  render();
}

function onRecaptchaSubmit(response) {
  console.log('onRecaptchaSubmit:', response);
  var self = this;

  MoneyPot.claimFaucet(response, {
    success: function(data) {
      console.log('Successful claim:', data);
      worldStore.user.balance += data.amount;
      worldStore.faucetResult = 'FAUCET_SUCCESS';
      worldStore.claimedAt = new Date();
      localStorage.setItem('claimed_at', (new Date()).toISOString());
      render();
    },
    error: function(xhr, textStatus, errorThrown) {
      console.log('Error from /claim-faucet');
      if (xhr.responseJSON && xhr.responseJSON.error === 'FAUCET_ALREADY_CLAIMED') {
        console.log('Faucet already claimed');
        worldStore.faucetResult = 'FAUCET_ALREADY_CLAIMED';
        worldStore.claimedAt = new Date();
        render();
      }
    }
  });
}

function onLogout() {
  localStorage.clear();
  location.reload();
}

function onWithdrawClick() {
  var windowUrl = 'https://www.moneypot.com/dialog/withdraw?app_id=' + config.app_id;
  var windowName = 'manage-auth';
  var windowOpts = 'width=420,height=350,left=100,top=100';
  var windowRef = window.open(windowUrl, windowName, windowOpts);
  windowRef.focus();
}

setInterval(function() {
  var fiveMinutesAgo = new Date(Date.now() - 1000*60*5);

  if (worldStore.claimedAt && worldStore.claimedAt < fiveMinutesAgo) {
    console.log('Five minutes has passed since last claim');
    worldStore.claimedAt = undefined;
    render();
  }
}, 1000);


if (worldStore.accessToken) {
  MoneyPot.getTokenInfo({
    success: function(data) {
      console.log('[getTokenInfo] Success:', data);
      worldStore.user = data && data.auth && data.auth.user;
      render();
    },
    error: function(xhr, textStatus, errorThrown) {
      console.error('[getTokenInfo] Error.', xhr, textStatus, errorThrown);
      worldStore.accessToken = undefined;
      localStorage.clear();
      render();
    }
  })
} else {
  render();
}
