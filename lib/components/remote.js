/**
 * Component for remote service.
 * Load remote service and add to global context.
 */
var fs = require('fs');
var pathUtil = require('../util/pathUtil');
var RemoteServer = require('pomelo-rpc').server;

/**
 * Remote component factory function
 *
 * @param {Object} app  current application context
 * @param {Object} opts construct parameters
 *                       opts.acceptorFactory {Object}: acceptorFactory.create(opts, cb)
 * @return {Object}     remote component instances
 */
module.exports = function(app, opts) {
  opts = opts || {};

  // cacheMsg is deprecated, just for compatibility here.
  opts.bufferMsg = opts.bufferMsg || opts.cacheMsg || false;
  opts.interval = opts.interval || 30;
  if(app.enabled('rpcDebugLog')) {
    opts.rpcDebugLog = true;
    opts.rpcLogger = require('pomelo-logger').getLogger('rpc-debug', __filename);
  }
  return new Component(app, opts);
};

/**
 * Remote component class
 *
 * @param {Object} app  current application context
 * @param {Object} opts construct parameters
 */
var Component = function(app, opts) {
  this.app = app;
  this.opts = opts;
};

var pro = Component.prototype;

pro.name = '__remote__';

/**
 * Remote component lifecycle function
 *
 * @param {Function} cb
 * @return {Void}
 */
pro.start = function(cb) {
  this.opts.port = this.app.getCurServer().port;
  this.remote = genRemote(this.app, this.opts);
  this.remote.on('connection', this.ipFilter.bind(this));

  if(this.opts.whitelistPath) {
    try {
      this.opts.whitelistPath = fs.realpathSync(this.opts.whitelistPath);
    } catch(err) {
      throw err;
    }
    this.whitelist = require(this.opts.whitelistPath);
    if(!(this.whitelist instanceof Array)) {
      throw new Error(this.opts.whitelistPath + ' should be an array.');
    } else {
      Array.prototype.push.apply(this.whitelist, ['127.0.0.1']);
    }
  }

  // this.remote.on('error', ...);

  this.remote.start();
  process.nextTick(cb);
};

/**
 * Remote component lifecycle function
 *
 * @param {Boolean}  force whether stop the component immediately
 * @param {Function}  cb
 * @return {Void}
 */
pro.stop = function(force, cb) {
  this.remote.stop(force);
  process.nextTick(cb);
};

/**
 * Remote component ip whitelist
 *
 * @param {strIp} ip which is emitted by acceptor
 * @return {Void}
 */
pro.ipFilter = function(obj) {
  if(this.whitelist && !!obj && !!obj.ip && !!obj.id){
    if(this.whitelist.indexOf(obj.ip) == -1) {
      this.remote.kickById(obj.id, 'unauthorized'); // kick out
    }
  }
};

/**
 * Get remote paths from application
 *
 * @param {Object} app current application context
 * @return {Array} paths
 *
 */
var getRemotePaths = function(app) {
  var paths = [];

  var role;
  // master server should not come here
  if(app.isFrontend()) {
    role = 'frontend';
  } else {
    role = 'backend';
  }

  var sysPath = pathUtil.getSysRemotePath(role), serverType = app.getServerType();
  if(fs.existsSync(sysPath)) {
    paths.push(pathUtil.remotePathRecord('sys', serverType, sysPath));
  }
  var userPath = pathUtil.getUserRemotePath(app.getBase(), serverType);
  if(fs.existsSync(userPath)) {
    paths.push(pathUtil.remotePathRecord('user', serverType, userPath));
  }

  return paths;
};

/**
 * Generate remote server instance
 *
 * @param {Object} app current application context
 * @param {Object} opts contructor parameters for rpc Server
 * @return {Object} remote server instance
 */
var genRemote = function(app, opts) {
  opts.paths = getRemotePaths(app);
  opts.context = app;
  return RemoteServer.create(opts);
};
