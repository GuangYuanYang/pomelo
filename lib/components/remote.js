/**
 * Component for remote service.
 * Load remote service and add to global context.
 */
var os = require('os');
var fs = require('fs');
var pathUtil = require('../util/pathUtil');
var Constants = require('../util/constants');
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
    this.loadWhitelist(this.opts.whitelistPath);
    this.opts.whitelistInterval = this.opts.whitelistInterval || (60 * 1 * 1000);
    fs.watchFile(this.opts.whitelistPath, {persistent: true, interval: this.opts.whitelistInterval}, this.listener4watch(this.opts.whitelistPath));
  }

  this.remote.start();
  process.nextTick(cb);
};

pro.loadWhitelist = function(filename) {
  delete require.cache[require.resolve(filename)]
  this.whitelist = require(filename);
  if(!(this.whitelist instanceof Array)) {
    throw new Error(filename + ' should be an array.');
  } else {
    var localIPList = ['127.0.0.1'];
    var platform = os.platform();
    var tmpObj = os.networkInterfaces();
    if(platform === Constants.PLATFORM.LINUX) {
      tmpObj = tmpObj.eth0;
    } else if(platform === Constants.PLATFORM.WIN) {
      tmpObj = tmpObj['Local Area Connection'];
    } else if(platform === Constants.PLATFORM.MAC) {
      tmpObj = tmpObj.en0;
    }
    for(var i = 0; i < tmpObj.length; i++){
      if(tmpObj[i].family === 'IPv4'){
        localIPList.push(tmpObj[i].address);
      }
    }
    Array.prototype.push.apply(this.whitelist, localIPList);
  }
};

pro.listener4watch = function(filename) {
  var self = this;
  return function(curr, prev) {
    if(curr.mtime.getTime() > prev.mtime.getTime()) {
      self.loadWhitelist(filename);
      console.warn('\n', Date(), ': Listener4watch ~  whitelist = ', JSON.stringify(self.whitelist));
      }
    };
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
 * @param {obj} is emitted by acceptor
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
