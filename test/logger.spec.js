/* global describe */
/* global before */
/* global beforeEach */
/* global it */
/* global after */
/* global afterEach */

require( 'should' );
const sinon = require( 'sinon' );
const requireSubvert = require( 'require-subvert' )( __dirname );

let SumoLogger = require( '../index.js' );
const defaultOpts = {
    collector: 'FAKE-COLLECTOR',
    rewriteLevels: false
};

describe( 'Bunyan SumoLogic Tests', () => {
    let requestStub = null;
    let onEndCallbackSpy = null;
    before( () => {
        // Intercept the request module used by bunyan-sumologic
        requestStub = sinon.stub();
        requireSubvert.subvert( 'request', requestStub );
        SumoLogger = requireSubvert.require( '../index.js' );
        onEndCallbackSpy = sinon.spy();
    } );

    after( () => {
        requireSubvert.cleanUp();
    } );

    let clock;
    beforeEach( () => {
        clock = sinon.useFakeTimers();
        requestStub.reset();
        onEndCallbackSpy.reset();
    } );
    afterEach( () => {
        clock.restore();
    } );


    describe( 'Test Syncing Logic', () => {
        it( 'Should not sync for first second', () => {
            const logger = new SumoLogger( defaultOpts );
            logger.write( { level: 30, msg: 'log message' } );

            clock.tick( 1 );
            requestStub.called.should.not.be.true();
            clock.tick( 998 );
            requestStub.called.should.not.be.true();
        } );

        it( 'Should not sync if there\'s no log data', () => {
            const logger = new SumoLogger( defaultOpts ); // eslint-disable-line no-unused-vars

            clock.tick( 1000 );
            requestStub.called.should.be.false();
            clock.tick( 1000 );
            requestStub.called.should.be.false();
        } );

        it( 'Should only have one in progress request at any time', () => {
            const logger = new SumoLogger( defaultOpts ); // eslint-disable-line no-unused-vars
            logger.write( { level: 30, msg: 'log message' } );

            // First call to request
            clock.tick( 1000 );
            requestStub.calledOnce.should.be.true();

            // Shouldn't call request, as we have an active call
            clock.tick( 1000 );
            requestStub.calledOnce.should.be.true();
        } );

        it( 'Should retry failed requests first', () => {
            const logger = new SumoLogger( defaultOpts );
            let expectedBody = null;

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


        it( 'Should treat non 200/300status codes as errors', () => {
            const logger = new SumoLogger( defaultOpts );
            let expectedBody = null;

            function testStatus( status ) {
                clock.tick( 1000 );
                const request = requestStub.lastCall.args[ 0 ];
                request.body.should.deepEqual( expectedBody );
                requestStub.callArgWith( 1, null, { status } ); // call callback function to complete request
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

        it( 'Should handle happy case of syncing logs successfully in each cycle', () => {
            const logger = new SumoLogger( defaultOpts );

            let expectedBody = '';

            function logLine( level, msg ) {
                const record = { level, msg };
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


    describe( 'Test Configuration Options', () => {
        it( 'Should require collector id to be passed', () => {
            ( () => {
                const logger = new SumoLogger( {} ); // eslint-disable-line no-unused-vars
            } ).should.throwError();
        } );

        it( 'Should format the SumoLogic URL correctly', () => {
            const logger = new SumoLogger( defaultOpts );
            logger.write( { level: 30, msg: 'log message' } );

            clock.tick( 1000 );
            const request = requestStub.lastCall.args[ 0 ];

            request.method.should.equal( 'POST' );
            request.url.should.equal( `https://endpoint1.collection.us2.sumologic.com/receiver/v1/http/${defaultOpts.collector}` );
        } );

        it( 'Should allow overriding of SumoLogic endpoint URL', () => {
            const opts = {
                collector: 'FAKE-COLLECTOR',
                endpoint: 'http://fake-endpoint/'
            };
            const logger = new SumoLogger( opts );
            logger.write( { level: 30, msg: 'log message' } );

            clock.tick( 1000 );
            const request = requestStub.lastCall.args[ 0 ];

            request.url.should.equal( `${opts.endpoint}${opts.collector}` );
        } );

        it( 'Should rewrite level names correctly', () => {
            const opts = { collector: defaultOpts.collector, rewriteLevels: true };
            const logger = new SumoLogger( opts );

            function testRewrite( input, expected ) {
                logger.write( input );
                clock.tick( 1000 );

                const request = requestStub.lastCall.args[ 0 ];
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

        it( 'Should rewrite level names by default', () => {
            const opts = { collector: 'FAKE-COLLECTOR' }; // rewriteLevels is true by default
            const logger = new SumoLogger( opts );

            function testRewrite( input, expected ) {
                logger.write( input );
                clock.tick( 1000 );

                const request = requestStub.lastCall.args[ 0 ];
                request.body.should.deepEqual( expected );
                requestStub.callArgWith( 1, null, { status: 200 } ); // call callback function to complete request successfully
            }

            testRewrite( { level: 30, msg: 'log message' }, '{"level":"INFO","msg":"log message"}' );
        } );

        it( 'Should allow syncInterval to be overridden', () => {
            const opts = { collector: 'FAKE-COLLECTOR', syncInterval: 2000 };
            const logger = new SumoLogger( opts );
            logger.write( { level: 30, msg: 'log message' } );

            clock.tick( 1000 );
            requestStub.called.should.be.false();
            clock.tick( 1000 );
            requestStub.called.should.be.true();
        } );
    } );


    describe( 'Test Internal Features', () => {
        it( 'Should handle all types of input without error', () => {
            const logger = new SumoLogger( defaultOpts );

            function testInput( input, expected ) {
                const expectedBody = expected || JSON.stringify( input );
                logger.write( input );
                clock.tick( 1000 );

                const request = requestStub.lastCall.args[ 0 ];
                request.body.should.deepEqual( expectedBody );
                requestStub.callArgWith( 1, null, { status: 200 } ); // call callback function to complete request successfully
            }

            testInput( 'msg 1' );
            testInput( {} );

            // circular refs will confuse JSON.stringify, fallback to toString
            const x = {};
            x.y = x;
            testInput( x, '"[object Object]"' );

            // Check errors in toString are handled
            function TestObj() { }
            TestObj.prototype.toJSON = () => { throw new Error(); };
            TestObj.prototype.toString = () => { throw new Error(); };
            testInput( new TestObj(), '"error serializing log line"' );
        } );

        it( 'Should only output valid JSON', () => {
            const logger = new SumoLogger( defaultOpts );

            function testJSON( input ) {
                logger.write( input );
                clock.tick( 1000 );

                const request = requestStub.lastCall.args[ 0 ];
                const parsed = JSON.parse( request.body );
                parsed.should.deepEqual( input );
                requestStub.callArgWith( 1, null, { status: 200 } ); // call callback function to complete request successfully
            }

            testJSON( 'msg 1' );
            testJSON( { some: 'values', and: 'keys' } );
            testJSON( [ 1, 2, 3, 4 ] );
        } );
    } );


    describe( 'Test End Method ', () => {
        it( 'Should call end callback immeditely if there are no pending requests', () => {
            const logger = new SumoLogger( defaultOpts );

            logger.end( onEndCallbackSpy );

            onEndCallbackSpy.calledOnce.should.equal( true );
            onEndCallbackSpy.calledWith( null ).should.equal( true );
        } );

        it( 'Should call end only after request completes', () => {
            const logger = new SumoLogger( defaultOpts );

            logger.write( 'msg 1' );
            logger.end( onEndCallbackSpy );
            clock.tick( 1000 );

            onEndCallbackSpy.calledOnce.should.equal( false );
            requestStub.callArgWith( 1, null, { status: 200 } );
            onEndCallbackSpy.calledOnce.should.equal( true );
            onEndCallbackSpy.calledWith( null ).should.equal( true );
        } );

        it( 'Should call end with error from pending request', () => {
            const logger = new SumoLogger( defaultOpts );
            const error = new Error( 'some error' );

            logger.write( 'msg 1' );
            logger.end( onEndCallbackSpy );
            clock.tick( 1000 );

            onEndCallbackSpy.calledOnce.should.equal( false );
            requestStub.callArgWith( 1, error );
            onEndCallbackSpy.calledOnce.should.equal( true );
            onEndCallbackSpy.calledWith( error ).should.equal( true );
        } );
    } );
} );
