/* global describe */
/* global before */
/* global beforeEach */
/* global it */
/* global after */
/* global afterEach */

require( 'should' );
var sinon = require( 'sinon' );
var requireSubvert = require( 'require-subvert' )( __dirname );

var SumoLogger = require( '../index.js' );
var defaultOpts = {
    collector: 'FAKE-COLLECTOR',
    rewriteLevels: false
};

describe( 'Bunyan SumoLogic Tests', function() {
    var requestStub = null;
    before( function() {
        // Intercept the request module used by bunyan-sumologic
        requestStub = sinon.stub();
        requireSubvert.subvert( 'request', requestStub );
        SumoLogger = requireSubvert.require( '../index.js' );
    } );

    after( function() {
        requireSubvert.cleanUp();
    } );

    var clock;
    beforeEach( function() {
        clock = sinon.useFakeTimers();
        requestStub.reset();
    } );
    afterEach( function() {
        clock.restore();
    } );


    describe( 'Test Syncing Logic', function() {
        it( 'Should not sync for first second', function() {
            var logger = new SumoLogger( defaultOpts );
            logger.write( { level: 30, msg: 'log message' } );

            clock.tick( 1 );
            requestStub.called.should.not.be.true();
            clock.tick( 998 );
            requestStub.called.should.not.be.true();
        } );

        it( 'Should not sync if there\'s no log data', function() {
            var logger = new SumoLogger( defaultOpts ); // eslint-disable-line no-unused-vars

            clock.tick( 1000 );
            requestStub.called.should.be.false();
            clock.tick( 1000 );
            requestStub.called.should.be.false();
        } );

        it( 'Should only have one in progress request at any time', function() {
            var logger = new SumoLogger( defaultOpts ); // eslint-disable-line no-unused-vars
            logger.write( { level: 30, msg: 'log message' } );

            // First call to request
            clock.tick( 1000 );
            requestStub.calledOnce.should.be.true();

            // Shouldn't call request, as we have an active call
            clock.tick( 1000 );
            requestStub.calledOnce.should.be.true();
        } );

        it( 'Should retry failed requests first', function() {
            var logger = new SumoLogger( defaultOpts );
            var expectedBody = null;

            function testFailedSync() {
                clock.tick( 1000 );
                const request = requestStub.lastCall.args[ 0 ];
                request.body.should.deepEqual( expectedBody );
                requestStub.callArgWith( 1, 'Send Failed' ); // call callback function to complete request
            }


            logger.write( { level: 30, msg: 'log message' } );
            expectedBody = '{"level":30,"msg":"log message"}';

            testFailedSync();
            testFailedSync(); // Get same body on second attempt

            logger.write( { level: 40, msg: 'log message 2' } );
            expectedBody = '{"level":30,"msg":"log message"}\n{"level":40,"msg":"log message 2"}';

            testFailedSync(); // Body now has two log records
        } );


        it( 'Should treat non 200/300status codes as errors', function() {
            var logger = new SumoLogger( defaultOpts );
            var expectedBody = null;

            function testStatus( status ) {
                clock.tick( 1000 );
                const request = requestStub.lastCall.args[ 0 ];
                request.body.should.deepEqual( expectedBody );
                requestStub.callArgWith( 1, null, { status: status } ); // call callback function to complete request
            }


            logger.write( { level: 30, msg: 'log message' } );
            expectedBody = '{"level":30,"msg":"log message"}';

            testStatus( 100 );
            testStatus( 400 );
            testStatus( 500 );
            testStatus( 200 ); // Will clear all unsynced logs

            requestStub.callCount.should.equal( 4 );
            clock.tick( 1000 ); // Should not call again because unsynced is empty
            requestStub.callCount.should.equal( 4 );
        } );

        it( 'Should handle happy case of syncing logs successfully in each cycle', function() {
            var logger = new SumoLogger( defaultOpts );

            var expectedBody = '';

            function logLine( level, msg ) {
                var record = { level: level, msg: msg };
                logger.write( record );

                if ( expectedBody.length ) expectedBody += '\n';
                expectedBody += JSON.stringify( record );
            }
            function testSync() {
                clock.tick( 1000 );
                const request = requestStub.lastCall.args[ 0 ];
                request.body.should.deepEqual( expectedBody );
                requestStub.callArgWith( 1, null, { status: 200 } ); // call callback function to complete request successfully

                expectedBody = '';
            }


            logLine( 30, 'msg 1' );
            logLine( 40, 'msg 2' );
            logLine( 50, 'msg 3' );
            testSync();

            logLine( 30, 'msg 4' );
            testSync();

            logLine( 20, 'msg 5' );
            logLine( 30, 'msg 6' );
            logLine( 40, 'msg 7' );
            logLine( 50, 'msg 8' );
            testSync();
        } );
    } );


    describe( 'Test Configuration Options', function() {
        it( 'Should require collector id to be passed', function() {
            ( function() {
                var logger = new SumoLogger( {} ); // eslint-disable-line no-unused-vars
            } ).should.throwError();
        } );

        it( 'Should format the SumoLogic URL correctly', function() {
            var logger = new SumoLogger( defaultOpts );
            logger.write( { level: 30, msg: 'log message' } );

            clock.tick( 1000 );
            var request = requestStub.lastCall.args[ 0 ];

            request.method.should.equal( 'POST' );
            request.url.should.equal( 'https://endpoint1.collection.us2.sumologic.com/receiver/v1/http/' + defaultOpts.collector );
        } );

        it( 'Should allow overriding of SumoLogic endpoint URL', function() {
            var opts = {
                collector: 'FAKE-COLLECTOR',
                endpoint: 'http://fake-endpoint/'
            };
            var logger = new SumoLogger( opts );
            logger.write( { level: 30, msg: 'log message' } );

            clock.tick( 1000 );
            var request = requestStub.lastCall.args[ 0 ];

            request.url.should.equal( opts.endpoint + opts.collector );
        } );

        it( 'Should rewrite level names correctly', function() {
            var opts = { collector: defaultOpts.collector, rewriteLevels: true };
            var logger = new SumoLogger( opts );

            function testRewrite( input, expected ) {
                logger.write( input );
                clock.tick( 1000 );

                var request = requestStub.lastCall.args[ 0 ];
                request.body.should.deepEqual( expected );
                requestStub.callArgWith( 1, null, { status: 200 } ); // call callback function to complete request successfully
            }

            testRewrite( { level: 10, msg: 'log message' }, '{"level":"TRACE","msg":"log message"}' );
            testRewrite( { level: 20, msg: 'log message' }, '{"level":"DEBUG","msg":"log message"}' );
            testRewrite( { level: 30, msg: 'log message' }, '{"level":"INFO","msg":"log message"}' );
            testRewrite( { level: 40, msg: 'log message' }, '{"level":"WARN","msg":"log message"}' );
            testRewrite( { level: 50, msg: 'log message' }, '{"level":"ERROR","msg":"log message"}' );
            testRewrite( { level: 60, msg: 'log message' }, '{"level":"FATAL","msg":"log message"}' );
        } );

        it( 'Should rewrite level names by default', function() {
            var opts = { collector: 'FAKE-COLLECTOR' }; // rewriteLevels is true by default
            var logger = new SumoLogger( opts );

            function testRewrite( input, expected ) {
                logger.write( input );
                clock.tick( 1000 );

                const request = requestStub.lastCall.args[ 0 ];
                request.body.should.deepEqual( expected );
                requestStub.callArgWith( 1, null, { status: 200 } ); // call callback function to complete request successfully
            }

            testRewrite( { level: 30, msg: 'log message' }, '{"level":"INFO","msg":"log message"}' );
        } );

        it( 'Should allow syncInterval to be overridden', function() {
            var opts = { collector: 'FAKE-COLLECTOR', syncInterval: 2000 };
            var logger = new SumoLogger( opts );
            logger.write( { level: 30, msg: 'log message' } );

            clock.tick( 1000 );
            requestStub.called.should.be.false();
            clock.tick( 1000 );
            requestStub.called.should.be.true();
        } );
    } );


    describe( 'Test Internal Features', function() {
        it( 'Should handle all types of input without error', function() {
            var logger = new SumoLogger( defaultOpts );

            function testInput( input, expected ) {
                var expectedBody = expected || JSON.stringify( input );
                logger.write( input );
                clock.tick( 1000 );

                var request = requestStub.lastCall.args[ 0 ];
                request.body.should.deepEqual( expectedBody );
                requestStub.callArgWith( 1, null, { status: 200 } ); // call callback function to complete request successfully
            }

            testInput( 'msg 1' );
            testInput( {} );

            // circular refs will confuse JSON.stringify, fallback to toString
            var x = {};
            x.y = x;
            testInput( x, '"[object Object]"' );

            // Check errors in toString are handled
            function TestObj() { }
            TestObj.prototype.toJSON = function() { throw new Error(); };
            TestObj.prototype.toString = function() { throw new Error(); };
            testInput( new TestObj(), '"error serializing log line"' );
        } );

        it( 'Should only output valid JSON', function() {
            var logger = new SumoLogger( defaultOpts );

            function testJSON( input ) {
                logger.write( input );
                clock.tick( 1000 );

                var request = requestStub.lastCall.args[ 0 ];
                var parsed = JSON.parse( request.body );
                parsed.should.deepEqual( input );
                requestStub.callArgWith( 1, null, { status: 200 } ); // call callback function to complete request successfully
            }

            testJSON( 'msg 1' );
            testJSON( { some: 'values', and: 'keys' } );
            testJSON( [ 1, 2, 3, 4 ] );
        } );
    } );
} );
