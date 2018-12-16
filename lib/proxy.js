var request = require('request');
var debug = require('debug')('jsforce-ajax-proxy');

/**
 * Allowed request headers 
 */
var ALLOWED_HEADERS = [
  'Authorization',
  'Content-Type',
  'Salesforceproxy-Endpoint',
  'X-Authorization',
  'X-SFDC-Session',
  'SOAPAction',
  'SForce-Auto-Assign',
  'If-Modified-Since',
  'X-User-Agent'
];

/**
 * Endpoint URL validation
 */
var SF_ENDPOINT_REGEXP =
  /^https?:\/\/[a-zA-Z0-9\.\-]+\.(visualforce|force|salesforce|cloudforce|database)\.com(:\d+)?\//;

/**
 * Create middleware to proxy request to salesforce server
 */
module.exports = function(options) {

  options = options || {}
  var proxyCounter = 0;

  return function(req, res) {
    if (options.enableCORS) {
      res.header('Access-Control-Allow-Origin', options.allowedOrigin || '*');
      res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE');
      res.header('Access-Control-Allow-Headers', ALLOWED_HEADERS.join(','));
      res.header('Access-Control-Expose-Headers', 'SForce-Limit-Info');
      if (req.method === 'OPTIONS') {
        res.end();
        return;
      }
    }
    var sfEndpoint = req.headers["salesforceproxy-endpoint"];
    if (!SF_ENDPOINT_REGEXP.test(sfEndpoint)) {
      res.send(400, "Proxying endpoint is not allowed.");
      return;
    }
    var headers = {};
    ALLOWED_HEADERS.forEach(function(header) {
      header = header.toLowerCase();
      var value = req.headers[header]
      if (value) {
        var name = header === 'x-authorization' ? 'authorization' : header;
        headers[name] = req.headers[header];
      }
    });
    // since visualforce.com domains will result in a redirect, ensure this proxy handles the redirect
    var params = {
      url: sfEndpoint || "https://login.salesforce.com//services/oauth2/token",
      method: req.method,
      headers: headers,
      followAllRedirects: true, // this will follow all redirect regardless of the http method
      followOriginalHttpMethod: true // this will follow the redirect using the same http method as the original request
    };
    if(options.proxy && typeof options.proxy[req.method] === 'function') {
    	options.proxy[req.method](params);
    	return;
    }
    proxyCounter++;
    debug("(++req++) " + new Array(proxyCounter+1).join('*'));
    debug("method=" + params.method + ", url=" + params.url);

    var body;
    var requestObj = request(params);

    // overwrite the request.write function to capture the body in case of a redirect
    var writeFn = requestObj.write.bind(requestObj);
    requestObj.write = function() {
      body = arguments[0];
      return writeFn.apply(requestObj, arguments);
    }.bind(requestObj);

    req.pipe(requestObj)
      .on('response', function() {
        proxyCounter--;
        debug("(--res--) " + new Array(proxyCounter+1).join('*'));
      })
      .on('error', function() {
        proxyCounter--;
        debug("(--err--) " + new Array(proxyCounter+1).join('*'));
      })
      .on('redirect', function() {
        if (this.uri && this.uri.href && SF_ENDPOINT_REGEXP.test(this.uri.href)) {
            // since we are redirecting to another valid salesforce URL then add back the headers from the original request
            this.setHeader('authorization', req.headers['authorization']);
            this.setHeader('content-type', req.headers['content-type']);
            // since we are following PATCH or POST redirects as well, lets also add back the body of the original request
            if(body) this.body = body;
        }
      })
      .pipe(res);
  }
};
