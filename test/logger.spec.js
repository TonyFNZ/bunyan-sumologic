/* global describe */
/* global before */
/* global beforeEach */
/* global it */
/* global after */
/* global afterEach */

const assert = require( 'assert' );
const sinon = require( 'sinon' );
const requireSubvert = require( 'require-subvert' )( __dirname );

let SumoLogger = require( '../index.js' );
const defaultOpts = {
    collector: 'FAKE-COLLECTOR',
    rewriteLevels: false
};

describe( 'Bunyan SumoLogic Tests', () => {
    let requestStub = null;
    before( () => {
        // Intercept the request module used by bunyan-sumologic
        requestStub = sinon.stub();
        requireSubvert.subvert( 'request', requestStub );
        SumoLogger = requireSubvert.require( '../index.js' );
    } );

    after( () => {
        requireSubvert.cleanUp();
    } );

    let clock;
    beforeEach( () => {
        clock = sinon.useFakeTimers();
        requestStub.reset();
    } );
    afterEach( () => {
        clock.restore();
    } );


    describe( 'Test Syncing Logic', () => {
        it( 'Should not sync for first second', () => {
            const logger = new SumoLogger( defaultOpts );
            logger.write( { level: 30, msg: 'log message' } );

            clock.tick( 1 );
            assert( !requestStub.called );
            clock.tick( 998 );
            assert( !requestStub.called );
        } );

        it( 'Should not sync if there\'s no log data', () => {
            const logger = new SumoLogger( defaultOpts ); // eslint-disable-line no-unused-vars

            clock.tick( 1000 );
            assert( !requestStub.called );
            clock.tick( 1000 );
            assert( !requestStub.called );
        } );

        it( 'Should only have one in progress request at any time', () => {
            const logger = new SumoLogger( defaultOpts ); // eslint-disable-line no-unused-vars
            logger.write( { level: 30, msg: 'log message' } );

            // First call to request
            clock.tick( 1000 );
            assert( requestStub.calledOnce );

            // Shouldn't call request, as we have an active call
            clock.tick( 1000 );
            assert( requestStub.calledOnce );
        } );

        it( 'Should retry failed requests first', () => {
            const logger = new SumoLogger( defaultOpts );
            let expectedBody = null;

            function testFailedSync() {
                clock.tick( 1000 );
                const request = requestStub.lastCall.args[ 0 ];
                assert.equal( request.body, expectedBody );
                requestStub.callArgWith( 1, 'Send Failed' ); // call callback function to complete request
            }


            logger.write( { level: 30, msg: 'log message' } );
            expectedBody = '{"level":30,"msg":"log message"}';

            testFailedSync();
            testFailedSync(); // Get same body on second attempt

            logger.write( { level: 40, msg: 'log message 2' } );
            expectedBody = '{"level":30,"msg":"log message"}\n{"level":40,"msg":"log message 2"}';

            // Third retry attempt, should have 2 lines to sync (the original and the new line just added)
            testFailedSync();
        } );


        it( 'Should treat non 200/300status codes as errors', () => {
            const logger = new SumoLogger( defaultOpts );
            let expectedBody = null;

            function testStatus( status ) {
                clock.tick( 1000 );
                const request = requestStub.lastCall.args[ 0 ];
                assert.equal( request.body, expectedBody );
                requestStub.callArgWith( 1, null, { status } ); // call callback function to complete request
            }


            logger.write( { level: 30, msg: 'log message' } );
            expectedBody = '{"level":30,"msg":"log message"}';

            testStatus( 100 );
            testStatus( 400 );
            testStatus( 500 );
            testStatus( 200 ); // Will clear all unsynced logs

            clock.tick( 1000 );
            assert.equal( requestStub.callCount, 4, 'Request should not be called when unsynced is empty' );
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
                assert.equal( request.body, expectedBody );
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

    describe( 'Test Internal Features', () => {
        it( 'Should format the SumoLogic URL correctly', () => {
            const logger = new SumoLogger( defaultOpts );
            logger.write( { level: 30, msg: 'log message' } );

            clock.tick( 1000 );
            const opts = requestStub.lastCall.args[ 0 ];

            assert.equal( opts.method, 'POST' );
            assert.equal( opts.url, `https://endpoint1.collection.us2.sumologic.com/receiver/v1/http/${defaultOpts.collector}` );
        } );

        it( 'Should handle all types of input without error', () => {
            const logger = new SumoLogger( defaultOpts );

            function testInput( input, expected ) {
                const expectedBody = expected || JSON.stringify( input );
                logger.write( input );
                clock.tick( 1000 );

                const request = requestStub.lastCall.args[ 0 ];
                assert.equal( request.body, expectedBody );
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

        it( 'Should rewrite level names correctly', () => {
            const opts = { collector: defaultOpts.collector, rewriteLevels: true };
            const logger = new SumoLogger( opts );

            function testRewrite( input, expected ) {
                logger.write( input );
                clock.tick( 1000 );

                const request = requestStub.lastCall.args[ 0 ];
                assert.equal( request.body, expected );
                requestStub.callArgWith( 1, null, { status: 200 } ); // call callback function to complete request successfully
            }

            testRewrite( { level: 10, msg: 'log message' }, '{"level":"TRACE","msg":"log message"}' );
            testRewrite( { level: 20, msg: 'log message' }, '{"level":"DEBUG","msg":"log message"}' );
            testRewrite( { level: 30, msg: 'log message' }, '{"level":"INFO","msg":"log message"}' );
            testRewrite( { level: 40, msg: 'log message' }, '{"level":"WARN","msg":"log message"}' );
            testRewrite( { level: 50, msg: 'log message' }, '{"level":"ERROR","msg":"log message"}' );
            testRewrite( { level: 60, msg: 'log message' }, '{"level":"FATAL","msg":"log message"}' );
        } );

        it( 'Should only output valid JSON', () => {
            const logger = new SumoLogger( defaultOpts );

            function testJSON( input ) {
                logger.write( input );
                clock.tick( 1000 );

                const request = requestStub.lastCall.args[ 0 ];
                const parsed = JSON.parse( request.body );
                assert.deepEqual( parsed, input );
                requestStub.callArgWith( 1, null, { status: 200 } ); // call callback function to complete request successfully
            }

            testJSON( 'msg 1' );
            testJSON( { some: 'values', and: 'keys' } );
            testJSON( [ 1, 2, 3, 4 ] );
        } );
    } );
} );
