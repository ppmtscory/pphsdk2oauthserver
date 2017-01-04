var express = require('express'),
    app = express(),
    util = require('util'),
    paypal = require('./'),
    braintree = require("braintree"),
    bodyParser = require('body-parser');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

var gateway = braintree.connect({
  environment: braintree.Environment.Sandbox,
  merchantId: process.env.BT_MERCHANT_ID,
  publicKey: process.env.BT_PUBLIC_KEY,
  privateKey: process.env.BT_PRIVATE_KEY
});

// **************  BT Stuffs  **************

var TRANSACTION_SUCCESS_STATUSES = [
  braintree.Transaction.Status.Authorizing,
  braintree.Transaction.Status.Authorized,
  braintree.Transaction.Status.Settled,
  braintree.Transaction.Status.Settling,
  braintree.Transaction.Status.SettlementConfirmed,
  braintree.Transaction.Status.SettlementPending,
  braintree.Transaction.Status.SubmittedForSettlement
];

app.get("/client_token", function (req, res) {
  gateway.clientToken.generate({}, function (err, response) {
    res.send(response.clientToken);
  });
});

app.post("/checkout", function (req, res) {
  // var nonceFromTheClient = req.body.payment_method_nonce;
  // var pmtAmount = req.body.price;
  var flow = req.body.flow;
  console.log('noncefromclient: %s', req.body.payment_method_nonce);
  console.log('flow chosen: %s', flow);
  // Even though it's set to store on success, that's only for the BT console as there's
  // no actual DB hooked up to this at all (yet) for storing/retrieving
  if(flow == "vault") {
	var saleRequest = {
		amount: req.body.price,
		paymentMethodNonce: req.body.payment_method_nonce,
		orderId: 'btVault' + getRandomArbitrary(1,9999),
		options: {
			paypal: {
			  customField: "btVaultCustomField",
			  description: "BT Vault Transaction",
			},
			submitForSettlement: true,
			storeInVaultOnSuccess: true
		}
	};
  } else if(flow == "checkout") {
  	var saleRequest = {
	  amount: req.body.price,
	  paymentMethodNonce: req.body.payment_method_nonce,
	  orderId: 'btCheckout' + getRandomArbitrary(1,9999),
	  options: {
	    paypal: {
	      customField: "btCheckoutCustomField",
	      description: "BT Checkout Transaction",
	    },
	    submitForSettlement: true
	  }
	};
  }
  // Use payment method nonce here
  gateway.transaction.sale(saleRequest, function (err, result) {
    if (result.success || result.transaction) {
        res.redirect('checkouts/' + result.transaction.id);
    } else {
        transactionErrors = result.errors.deepErrors();
        req.flash('error', {msg: formatErrors(transactionErrors)});
        res.send(formatErrors(transactionErrors));
    }
  });
});

app.get('/checkouts/:id', function (req, res) {
  var result;
  var transactionId = req.params.id;

  gateway.transaction.find(transactionId, function (err, transaction) {
    result = createResultObject(transaction);
    res.send({transaction: transaction, result: result});
  });
});

function formatErrors(errors) {
  var formattedErrors = '';

  for (var i in errors) { 
    if (errors.hasOwnProperty(i)) {
      formattedErrors += 'Error: ' + errors[i].code + ': ' + errors[i].message + '\n';
    }
  }
  return formattedErrors;
}

function createResultObject(transaction) {
  var result;
  var status = transaction.status;

  if (TRANSACTION_SUCCESS_STATUSES.indexOf(status) !== -1) {
    result = {
      header: 'Sweet Success!',
      icon: 'success',
      message: 'Your test transaction has been successfully processed. See the Braintree API response and try again.'
    };
  } else {
    result = {
      header: 'Transaction Failed',
      icon: 'fail',
      message: 'Your test transaction has a status of ' + status + '. See the Braintree API response and try again.'
    };
  }

  return result;
}

// Returns a random number between min (inclusive) and max (exclusive)
function getRandomArbitrary(min, max) {
  return Math.floor(Math.random() * (max - min) + min);
}

// **************  End BT Stuffs  **************

/**
 * These are the variables we will look for in the environment, from "most important" to least
 */
// A random value used to provide additional control to disable compromised versions of your app
var APP_SECURE_IDENTIFIER = process.env.APP_SECURE_IDENTIFIER;
var PAYPAL_LIVE_CLIENTID = process.env.PAYPAL_LIVE_CLIENTID;
var PAYPAL_LIVE_SECRET = process.env.PAYPAL_LIVE_SECRET;
var PAYPAL_SANDBOX_CLIENTID = process.env.PAYPAL_SANDBOX_CLIENTID;
var PAYPAL_SANDBOX_SECRET = process.env.PAYPAL_SANDBOX_SECRET;
// The base URL by which this server can be reached on the Internet (e.g. for token refresh)
var ROOT_URL = process.env.ROOT_URL;
// For third-party use, you will want this site to redirect to your app after the login flow completes.
// This URL will receive the access_token, refresh_url, and expires_in values as query arguments.
// If you don't set this value, this server essentially becomes "first party use only" as all it can do
// is refresh tokens generated with /firstParty
var APP_REDIRECT_URL = process.env.APP_REDIRECT_URL;
// If a PayPal representative gives you a custom environment string, set it as this env var
var PAYPAL_CUSTOM_ENVIRONMENT = process.env.PAYPAL_CUSTOM_ENVIRONMENT;

var errors, warnings, hasLive, hasSandbox;

validateEnvironment();

if (!errors) {
    showStartupMessage();
}

// Pick it up from the request if it's not set, and wait to configure PayPal until we have it.
if (!ROOT_URL) {
    app.use(function (req, res, next) {
        if (!ROOT_URL) {
            ROOT_URL = req.protocol + '://' + req.get('host');
            showStartupMessage();
            configurePayPal();
        }
        next();
    });
} else {
    configurePayPal();
}

/******************************** Express Routes and Server ********************************/

if (isSetupEnabled()) {
    // Allow
    app.get('/setup/:env', allErrorsAreBelongToUs, function (req, res) {
        res.redirect(paypal.redirect(req.params.env, '/setup'));
    });
    app.get('/setup', function (req, res) {
        res.send('<html><body><H1>InitializeMerchant Token</H1><p>This token requires this server to be running so it can ' +
            'be refreshed automatically. It will work for about 8 hours before a refresh is required.</p><br/><textarea id="key" cols="100" rows="10">' +
            req.query.sdk_token +
            '</textarea><script type="text/javascript">document.getElementById("key").select();</script></body>');
    });
}

if (APP_REDIRECT_URL) {
    app.get('/toPayPal/:env', allErrorsAreBelongToUs, function (req, res) {
        res.redirect(paypal.redirect(req.params.env, APP_REDIRECT_URL, !!req.query.returnTokenOnQueryString));
    });
}

app.get('/returnFromPayPal', function (req, res) {
    paypal.completeAuthentication(req.query, APP_SECURE_IDENTIFIER, function (error, destinationUrl) {
        if (error) {
            console.error(util.format('Failed to handle returnFromPayPal (%s): %s\n%s', error.env || 'unknown environment', error.message, error.stack));
            return res.status(500).send(error.message);
        }
        res.redirect(destinationUrl);
    });
});

app.get('/refresh', function (req, res) {
    paypal.refresh(req.query, APP_SECURE_IDENTIFIER, function (error, token) {
        if (error) {
            return res.status(500).send(error.message);
        }
        res.json(token);
    });
});

app.get('/', allErrorsAreBelongToUs, function (req, res) {
    var ret = '<html><body><h1>Server is Ready</h1>';
    if (isSetupEnabled()) {
        if (hasLive) {
            ret += '<a href="/setup/live">Setup a Live Account</a><br/>';
        }
        if (hasSandbox) {
            ret += '<a href="/setup/sandbox">Setup a Sandbox Account</a><br/>';
        }
    }
    ret += '</body></html>';
    res.send(ret);
});

var server = app.listen(process.env.PORT || 3000, function () {
    var host = server.address().address;
    var port = server.address().port;
    console.log('PayPal Retail SDK Service listening at http://%s:%s', host, port);
});


/******************************** The rest is just boring helpers ********************************/
function configurePayPal() {
    if (hasLive) {
        console.log('Configuring LIVE environment');
        // This line adds the live configuration to the PayPal module.
        // If you're going to write your own server, this is the money line
        paypal.configure(paypal.LIVE, {
            clientId: PAYPAL_LIVE_CLIENTID,
            secret: PAYPAL_LIVE_SECRET,
            returnUrl: combineUrl(ROOT_URL, 'returnFromPayPal'),
            refreshUrl: combineUrl(ROOT_URL, 'refresh'),
            scopes: process.env.SCOPES // This is optional, we have defaults in paypal-retail-node
        });
        checkScopes(paypal.LIVE);
    }
    if (hasSandbox) {
        console.log('Configuring SANDBOX environment');
        // This line adds the sandbox configuration to the PayPal module
        paypal.configure(paypal.SANDBOX, {
            clientId: PAYPAL_SANDBOX_CLIENTID,
            secret: PAYPAL_SANDBOX_SECRET,
            returnUrl: combineUrl(ROOT_URL, 'returnFromPayPal'),
            refreshUrl: combineUrl(ROOT_URL, 'refresh'),
            scopes: process.env.SCOPES // This is optional, we have defaults in paypal-retail-node
        });
        checkScopes(paypal.SANDBOX);
    }
    if (PAYPAL_CUSTOM_ENVIRONMENT) {
        try {
            var info = JSON.parse(new Buffer(PAYPAL_CUSTOM_ENVIRONMENT, 'base64').toString('utf8'));
            for (var envI = 0; envI < info.length; envI++) {
                console.log('Configuring', info[envI].name, 'environment');
                info[envI].returnUrl = info[envI].returnUrl || combineUrl(ROOT_URL, 'returnFromPayPal');
                info[envI].refreshUrl = info[envI].refreshUrl || combineUrl(ROOT_URL, 'refresh');
                paypal.configure(info[envI].name, info[envI]);
            }
            checkScopes(info[envI].name);
        } catch (x) {
            error('Invalid PAYPAL_CUSTOM_ENVIRONMENT: ' + x.message);
        }
    }
}

/**
 * Environment validation and usage display
 */
function validateEnvironment() {

    /**
     * Analyze the environment and make sure things are setup properly
     */
    if (!APP_SECURE_IDENTIFIER) {
        error('The APP_SECURE_IDENTIFIER value is missing from the environment. It should be set to a reasonably long set of random characters (e.g. 32)');
    }
    if (!APP_REDIRECT_URL && !process.env.SETUP_ENABLED) {
        error('Either APP_REDIRECT_URL (for third party merchant login) or SETUP_ENABLED (for first party token generation) must be set in the environment.');
    }
    if (!PAYPAL_LIVE_CLIENTID && !PAYPAL_SANDBOX_CLIENTID) {
        error('The server must be configured for sandbox, live, or both. Neither PAYPAL_LIVE_CLIENTID or PAYPAL_SANDBOX_CLIENTID is set in the environment.');
    } else {
        if (!PAYPAL_LIVE_CLIENTID) {
            warn('The server is only configured for Sandbox.');
        } else {
            if (!PAYPAL_LIVE_SECRET) {
                error('PAYPAL_LIVE_CLIENTID is set, but PAYPAL_LIVE_SECRET is not. The app needs the client id and secret to function.');
            } else {
                hasLive = true;
            }
        }
        if (!PAYPAL_SANDBOX_CLIENTID) {
            warn('The server is only configured for live.');
        } else {
            if (!PAYPAL_SANDBOX_SECRET) {
                error('PAYPAL_SANDBOX_CLIENTID is set, but PAYPAL_SANDBOX_SECRET is not. The app needs the client id and secret to function.');
            } else {
                hasSandbox = true;
            }
        }
    }
    if (!APP_REDIRECT_URL) {
        warn('The APP_REDIRECT_URL value is missing from the environment. You will only be able to use this service to authenticate via /setup.');
    }
    if (!ROOT_URL) {
        warn('The environment variable ROOT_URL should be set to the root URL of this server, such as http://mypaypalsdkserver.herokuapp.com');
    }
}

function checkScopes(env) {
    paypal.queryAvailableScopes(env, function (e, scopes) {
        if (e && e.missing) {
            error('\n\n\n!!! ' + e.message +
                '\n!!! Please go to https://developer.paypal.com/developer/applications/ and ensure the appropriate\n!!! permissions are assigned to your application in the ' + env.toUpperCase() +
                ' environment.\n!!! Until this is done, you will not be able to login and get an SDK token.\n\n');
        }
    });
}

function allErrorsAreBelongToUs(req, res, next) {
    if (errors && errors.length) {
        res.send('<html><body><h1>Configuration Errors</h1><ul><li>' + errors.join('</li><li>') + '</li></pre></body>');
    } else {
        next();
    }
}

function showStartupMessage() {
    console.log('/*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-');
    if (!ROOT_URL) {
        console.log(' *\n * ROOT_URL is not set, it will be set on first request and further configuration will happen then.');
    } else {
        if (isSetupEnabled()) {
            console.log(' * To generate a token for your account, open the following URL in a browser:\n *');
            if (hasLive) {
                console.log(' *     LIVE:    ' + combineUrl(ROOT_URL || '/', 'setup/live'));
            }
            if (hasSandbox) {
                console.log(' *     SANDBOX: ' + combineUrl(ROOT_URL || '/', 'setup/sandbox'));
            }
        }
        if (APP_REDIRECT_URL) {
            console.log(' *\n * To begin the authentication flow in your app, open a browser or webview on the target device to:\n *');
            if (PAYPAL_LIVE_CLIENTID) {
                console.log(' *     LIVE:    ' + combineUrl(ROOT_URL || '/', 'toPayPal/live'));
            }
            if (PAYPAL_SANDBOX_CLIENTID || true) {
                console.log(' *     SANDBOX: ' + combineUrl(ROOT_URL || '/', 'toPayPal/sandbox'));
            }
            console.log(' * \n * When the flow is complete, this site will redirect to:\n * ');
            console.log(' *     ' + APP_REDIRECT_URL + (APP_REDIRECT_URL.indexOf('?') >= 0 ? '&' : '?') + 'sdk_token=[what you give to InitializeMerchant]');
            console.log(' *\n * Your return url on developer.paypal.com must be set to:\n *');
            console.log(' *     ' + combineUrl(ROOT_URL, 'returnFromPayPal') + '\n *');
        }
    }
    console.log(' *\n *-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*/');
}

function isSetupEnabled() {
    return (process.env.SETUP_ENABLED || 'false').toLowerCase() === 'true';
}

function warn(msg) {
    warnings = warnings || [];
    warnings.push(msg);
    console.log('WARNING', msg);
}

function error(msg) {
    errors = errors || [];
    errors.push(msg);
    console.error('ERROR', msg);
}

function combineUrl(base, path) {
    if (base[base.length - 1] === '/') {
        return base + path;
    }
    return base + '/' + path;
}
