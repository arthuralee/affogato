var sinon = require('sinon');

var chai = require('chai');
chai.use(require('chai-spies'));
chai.use(require("sinon-chai"));
var istanbul = require('istanbul');

var jsdom = require("jsdom");
var Mocha = require('mocha');
var fs = require('fs');
var crypto = require('crypto');

var exports = module.exports = {};

/**
 * @param {Object} config Contains configuration options with the following:
 *                        {array.<string>} testFiles
 *                        {object} mochaOpts
 *                        {object} codeCoverage
 *                            {boolean} active
 *                            {array} reportType
 *                            {string} dir
 *                        {object} appSource
 *                            {array} prefix
 *                            {object} app
 *                            {array} suffix
 *                        {function(object)} setup
 *                        {function()} done
 *                        {string} injection
 *                        {string} buildDir
 *                        {string} url
 *                        {object} doneMessage
 **/
exports.runTests = function(config) {

    /**
     * Array of filepaths to the testFiles
     * @type {array.<string>}
     */
    var testFiles = config.testFiles;

    /**
     * Options for the Mocha test runner
     * @type {object}
     */
    var mochaOpts = {
        timeout: config.mochaOpts.timeout || 3000,
        reporter: config.mochaOpts.reporter || 'dot',
        spec: config.mochaOpts.spec || 'bdd',
    };

    /**
     * Code coverage reporting options
     *     active - turn code coverage on or off
     *     reportType - 'clover','cobertura','html','json','json-summary','lcov',
     *                  'lcovonly','none','teamcity','text','text-summary'
     *     dir - where to save code coverage report, defaults to runtime directory
     * @type {object}
     */
    var codeCoverage = {
        active: config.codeCoverage.active || false,
        reportType: config.codeCoverage.reportType || [],
        dir: config.codeCoverage.dir || buildDir
    };

    /**
     * Raw sources of javascript to load into the dom upon initialization
     *     prefix {array} - scripts to load before app JS
     *     app {object} - application scripts, will be instrumented if code coverage is turned on
     *         { 'reference_to_code': 'script' }
     *     suffix {array} - scripts to load after app JS
     * @type {object}
     */
    var appSource = config.appSource;

    /**
     * Setup function for the window
     * @type {function(object)}
     */
    var setup = config.setup;
    
    /**
     * `done` callback for Mocha test runner
     * @type {function()}
     */
    var done = config.done;

    /**
     * Raw javascript to inject into each test file
     * @type {string}
     */
    var injection = config.injection;

    /**
     * Build directory
     * @type {string}
     */
    var buildDir = config.buildDir;

    /**
     * URL for JSDom
     * @type {string}
     */
    var url = config.url;

    /**
     * Custom console message for each report type with key as report type, value
     * as the message (report types: 'clover','cobertura','html','json','json-summary',
     * 'lcov','lcovonly','none','teamcity','text','text-summary')
     * @type {Object}
     */
    var doneMessage = config.doneMessage;

    /**
     * DOMContentLoaded isn't fired by JSDom properly. Fire it manually.
     * From: http://stackoverflow.com/questions/9153314/manually-dispatchevent-domcontentloaded
     * @param window JSDom window object
     **/
    var fireDOMContentLoaded = function(window) {
        var DOMContentLoadedEvent = window.document.createEvent("Event")
        DOMContentLoadedEvent.initEvent("DOMContentLoaded", true, true)
        window.document.dispatchEvent(DOMContentLoadedEvent);
    };
    if (codeCoverage.active) {
        var instrumenter = new istanbul.Instrumenter();
        var collector = new istanbul.Collector();
        var reporter = new istanbul.Reporter(false, codeCoverage.dir);
        var instrumentedAppCode = [];
        for (var key in appSource.app) {
            fs.writeFileSync(buildDir + '/' + key + '.js', appSource.app[key]);
            instrumentedAppCode.push(instrumenter.instrumentSync(appSource.app[key], buildDir + '/' + key + '.js'));
        }
    } else {
        // Transform source code into an array
        var nonInstrumentedAppCode = [];
        for (var key in appSource.app) {
            nonInstrumentedAppCode.push(appSource.app[key]);
        }
    }

    appSource.app = codeCoverage.active ? instrumentedAppCode : nonInstrumentedAppCode;

    var sourceJs = appSource.prefix.concat(appSource.app,appSource.suffix);

    jsdom.env({
        virtualConsole: jsdom.createVirtualConsole().sendTo(console, { omitJsdomErrors: true }),
        url: url,
        html: "<div></div>",
        src: sourceJs,
        done: function(errors, window) {
            setup(window);
            global.sinon = sinon;
            global.assert = chai.assert;
            global.Promise = require('es6-promise').Promise;

            var mocha = new Mocha(mochaOpts);

            var ext = ".temp.aff";

            testFiles.forEach(function(file) {
                var fileMD5 = crypto.createHash('md5').update(file).digest("hex");
                var filename = buildDir + "/" + fileMD5 + ext;
                fs.writeFileSync(filename,
                    injection +
                    fs.readFileSync(file)
                 );
                mocha.addFile(filename);

            });

            fireDOMContentLoaded(window);

            mocha.run(function(errs) {
                done(errs === 0);

                if (codeCoverage.active) {
                    collector.add(window.__coverage__);
                    for (var i = 0; i < codeCoverage.reportType.length; i++) {
                        reporter.add(codeCoverage.reportType[i]);
                    }
                    reporter.write(collector, true, function () {
                        for (var key in doneMessage) {
                            if (codeCoverage.reportType.indexOf(key) > -1) {
                                console.log(doneMessage[key]);
                            }
                        }
                    });
                }

                testFiles.forEach(function(file) {
                    try {
                        var fileMD5 = crypto.createHash('md5').update(file).digest("hex");
                        var filename = buildDir + "/" + fileMD5 + ext;
                        fs.unlinkSync(filename);
                    } catch (e) {
                        /**
                         * Errors here are generally only due
                         * to race conditions between two processes
                         * both running the tests. No need to expose
                         * them to the user.
                         **/
                    }
                });
            });
        },
    });
};