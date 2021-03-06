// http://opcfoundation.org/UA/SecurityPolicy#Basic256


var opcua = require("../");
var should = require("should");
var assert = require('better-assert');
var async = require("async");
var util = require("util");

var utils = opcua.utils;

var OPCUAServer = opcua.OPCUAServer;
var OPCUAClient = opcua.OPCUAClient;
var StatusCodes = opcua.StatusCodes;
var Variant =  opcua.Variant ;
var DataType = opcua.DataType;
var DataValue = opcua.DataValue;
var SecurityPolicy = opcua.SecurityPolicy;

var BrowseDirection = opcua.browse_service.BrowseDirection;
var debugLog  = opcua.utils.make_debugLog(__filename);


var _ = require("underscore");

var port = 2222;

var build_server_with_temperature_device = require("./helpers/build_server_with_temperature_device").build_server_with_temperature_device;
var perform_operation_on_client_session = require("./helpers/perform_operation_on_client_session").perform_operation_on_client_session;


var start_simple_server = require("./helpers/external_server_fixture").start_simple_server;
var stop_simple_server = require("./helpers/external_server_fixture").stop_simple_server;



var server,temperatureVariableId, endpointUrl,serverCertificate;
function start_inner_server_local(callback) {
    // Given a server that have a signed end point
    server = build_server_with_temperature_device({ port: port}, function () {

        var data = {};
        data.endpointUrl = server.endpoints[0].endpointDescriptions()[0].endpointUrl;
        data.serverCertificate = server.endpoints[0].endpointDescriptions()[0].serverCertificate;
        data.temperatureVariableId = server.temperatureVariableId;
        data.server = server;
        callback(null,data);
    });
}

function stop_inner_server_local(data,callback) {
    var server  = data.server;
    server.currentChannelCount.should.equal(0);
    server.shutdown(callback);
}


function start_server1(callback) {
    // Given a server that have a signed end point
    start_simple_server(function(err,data){
        if (err) {
            return callback(err,null);
        }
        endpointUrl = data.endpointUrl;
        serverCertificate = data.serverCertificate;
        temperatureVariableId = "ns=1;i=1";
        callback(null,data);
    });
}

function stop_server1(data,callback) {
    stop_simple_server(data,callback);
}

function start_server(callback) {
    // Given a server that have a signed end point
    start_inner_server_local(function(err,data){
        if (err) {
            return callback(err,null);
        }
        endpointUrl = data.endpointUrl
        serverCertificate = data.serverCertificate;
        temperatureVariableId = data.temperatureVariableId;
        callback(null,data);
    });
}

function stop_server(data,callback) {
    stop_inner_server_local(data,callback);
}
//xx start_server=start_server1;
//xx stop_server=stop_server1;

var OPCUASession = opcua.OPCUASession;
var ClientSubscription = opcua.ClientSubscription;

function keep_monitoring_some_variable(session,nodeIdToMonitor,duration,done) {

    assert(session instanceof OPCUASession);

    var subscription = new ClientSubscription(session, {
        requestedPublishingInterval: 1000,
        requestedLifetimeCount: 100,
        requestedMaxKeepAliveCount: 3,
        maxNotificationsPerPublish: 3,
        publishingEnabled: true,
        priority: 6
    });

    var the_error = null;
    subscription.on("started", function () {
        setTimeout(function () {
            subscription.terminate();
        }, duration);
    });

    subscription.on("internal_error",function(err){
        //xx console.log("xxx internal error in ClientSubscription".red,err.message);
        the_error = err;
    });
    subscription.on("terminated", function () {
        done(the_error);
    });
}



describe("testing Secure Client-Server communication",function() {


    this.timeout(10000);

    var serverHandle, client;
    before(function (done) {
        start_server(function (err, handle) {
            serverHandle = handle;
            done(err);
        })
    });
    after(function (done) {
        stop_server(serverHandle, function(){
            done();
        });
    });

    it("a client shall be able to establish a SIGNED connection with a server", function (done) {


        should(serverCertificate).not.equal(null);

        var options = {
            securityMode: opcua.MessageSecurityMode.SIGN,
            securityPolicy: opcua.SecurityPolicy.Basic128Rsa15,
            serverCertificate: serverCertificate
        };
        client = new OPCUAClient(options);
        perform_operation_on_client_session(client, endpointUrl, function (session, done) {
            done();
        }, done);

    });

    it("a client shall be able to establish a SIGN&ENCRYPT connection with a server ", function (done) {

        should(serverCertificate).not.equal(null);

        var options = {
            securityMode: opcua.MessageSecurityMode.SIGNANDENCRYPT,
            securityPolicy: opcua.SecurityPolicy.Basic128Rsa15,
            serverCertificate: serverCertificate
        };
        client = new OPCUAClient(options);
        perform_operation_on_client_session(client, endpointUrl, function (session, inner_done) {
            inner_done();
        }, done);

    });

    it("a token shall be updated on a regular basis", function (done) {

        var options = {
            securityMode: opcua.MessageSecurityMode.SIGNANDENCRYPT,
            securityPolicy: opcua.SecurityPolicy.Basic128Rsa15,
            serverCertificate: serverCertificate,
            defaultSecureTokenLifetime: 100
        };

        var token_change = 0;
        client = new OPCUAClient(options);
        perform_operation_on_client_session(client, endpointUrl, function (session, inner_done) {

            keep_monitoring_some_variable(session, null, 2000, function () {
                token_change.should.be.greaterThan(10);
                inner_done();
            });
        }, done);

        client.on("lifetime_75", function (token) {
            //xx console.log("received lifetime_75", JSON.stringify(token));
        });
        client.on("security_token_renewed", function () {
            token_change += 1;
            //xx console.log("security_token_renewed");
        });

    });
});


var ClientSecureChannelLayer = require("../lib/client/client_secure_channel_layer").ClientSecureChannelLayer;

function common_test(securityPolicy,securityMode,done ) {

    //xx console.log("securityPolicy = ", securityPolicy,"securityMode = ",securityMode);

    opcua.MessageSecurityMode.get(securityMode).should.not.eql(null,"expecting supporting");


    var options ={
        securityMode:      opcua.MessageSecurityMode.get(securityMode),
        securityPolicy:    opcua.SecurityPolicy.get(securityPolicy),
        serverCertificate: serverCertificate,
        defaultSecureTokenLifetime: 100
    };

    var token_change = 0;
    var client = new OPCUAClient(options);

    perform_operation_on_client_session(client,endpointUrl,function(session,inner_done) {

        keep_monitoring_some_variable(session,null,options.defaultSecureTokenLifetime * 5,function(err) {
            token_change.should.be.greaterThan(3);
            inner_done(err);
        });
    },done);

    client.on("lifetime_75",function(token){
        //xx console.log("received lifetime_75",JSON.stringify(token));
    });
    client.on("security_token_renewed",function(){
        token_change+=1;
    });
    client.on("close",function(){
        //xx console.log(" connection has been closed");
    });
}

function common_test_expected_server_initiated_disconnection(securityPolicy,securityMode,done) {


    opcua.MessageSecurityMode.get(securityMode).should.not.eql(null,"expecting supporting");

    var options ={
        securityMode:      opcua.MessageSecurityMode.get(securityMode),
        securityPolicy:    opcua.SecurityPolicy.get(securityPolicy),
        serverCertificate: serverCertificate,
        defaultSecureTokenLifetime: 200
    };

    var token_change = 0;
    var client = new OPCUAClient(options);

    perform_operation_on_client_session(client,endpointUrl,function(session,inner_done) {

        keep_monitoring_some_variable(session,null,2000,function(err) {
            inner_done(err);
        });
    },function(err){
        console.log(" RECEIVED ERROR :".yellow.bold,err);

        should(err).be.instanceOf(Error);
        done();
    });

    client.on("lifetime_75",function(token){
        //xx console.log("received lifetime_75",JSON.stringify(token));
    });
    client.on("security_token_renewed",function(){
        token_change+=1;
    });
    client.on("close",function(){
        console.log(" connection has been closed");
    });
}

describe("testing server behavior on secure connection ",function(){

    this.timeout(10000);

    var serverHandle, client;
    var old_method;

    before(function (done) {

        // let modify the client behavior so that _renew_security_token call is delayed by an amount of time
        // that should cause the server to worry about the token not to be renewed.
        old_method = ClientSecureChannelLayer.prototype._renew_security_token;

        ClientSecureChannelLayer.prototype._renew_security_token = function() {
            var self = this;
            setTimeout(function(){ old_method.call(self); },1500);
        };

        start_server(function (err, handle) {
            serverHandle = handle;
            done(err);
        })
    });
    after(function (done) {

        ClientSecureChannelLayer.prototype._renew_security_token= old_method;

        stop_server(serverHandle, done);
    });

    it("server shall shutdown the connection if client doesn't renew security token on time",function(done){

        common_test_expected_server_initiated_disconnection(opcua.SecurityPolicy.Basic128Rsa15,opcua.MessageSecurityMode.SIGN,done);
    });

});


describe("testing various Security Policy",function(){


    this.timeout(10000);

    var serverHandle;

    before(function (done) {
        start_server(function (err, handle) {
            serverHandle = handle;
            done(err);
        })
    });
    after(function (done) {
        stop_server(serverHandle, function(){
            done();
        });
    });


    it('Basic128Rsa15 with Sign',function(done){
        common_test("Basic128Rsa15","SIGN",done);
    });

    it('Basic128Rsa15 with SignAndEncrypt',function(done){
        common_test("Basic128Rsa15","SIGNANDENCRYPT",done);
    });

    it('Basic256 with Sign',function(done) {
        common_test("Basic256","SIGN",done);
    });

    it('Basic256 with SignAndEncrypt',function(done) {
        common_test("Basic256","SIGNANDENCRYPT",done);
    });

    it('Basic256Rsa15 with Sign',function(done) {
        common_test("Basic256","SIGN",done);
    });

    it('Basic256Rsa15 with SignAndEncrypt',function(done) {
        common_test("Basic256","SIGNANDENCRYPT",done);
    });

    it("AA connection should fail if security mode requested by client is not supported by server",function(done) {

        var securityMode   = "SIGN";
        var securityPolicy = "Basic192Rsa15"; // !!! Our Server doesn't implement Basic192Rsa15 !!!
        var options ={
            securityMode:      opcua.MessageSecurityMode.get(securityMode),
            securityPolicy:    opcua.SecurityPolicy.get(securityPolicy),
            serverCertificate: serverCertificate,
            defaultSecureTokenLifetime: 200
        };
        var client = new OPCUAClient(options);
        client.connect(endpointUrl, function(err){

            if (err) {
                console.log("Error = ",err.message);
                done();
            } else {
                client.disconnect(function () {
                    done(new Error("The connection succedeed, but was expected to fail!"));
                });
            }
        });

    });

});

