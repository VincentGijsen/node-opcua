/**
 * @module opcua.transport
 */
// system requires
var EventEmitter = require("events").EventEmitter;
var assert = require('assert');
var _ = require("underscore");
var util = require('util');

// opcua requires
var opcua = require("../opcua.js");

var writeTCPMessageHeader = opcua.writeTCPMessageHeader;
var readRawMessageHeader = opcua.readRawMessageHeader;
var PacketAssembler = opcua.packet_assembler.PacketAssembler;
var hexDump = opcua.utils.hexDump;

var debugLog = opcua.utils.make_debugLog(__filename);
var doDebug = opcua.utils.checkDebugFlag(__filename);


var fakeSocket = { invalid: true};

exports.setFakeTransport = function (socket_like_mock) {
    fakeSocket = socket_like_mock;
};

exports.getFakeTransport = function () {
    return fakeSocket;
};

/**
 * TCP_transport
 *
 * @class TCP_transport
 * @constructor
 * @extends EventEmitter
 */
function TCP_transport() {


    /**
     * timeout
     * @property [timeout=2000]
     * @type {number}
     */
    this.timeout = 3000; // 2 seconds timeout

    this._socket = null;

    /**
     * @property headerSize the size of the header in Byte
     * @type {number}
     * @default  8
     */
    this.headerSize = 8;

    /**
     * @property protocolVersion indicates the version number of the OPCUA protocol used
     * @type {number}
     * @default  1
     */
    this.protocolVersion = 1;

    this.__disconnecting__ = false;

    this.bytesWritten = 0;
    this.bytesRead = 0;

}
util.inherits(TCP_transport, EventEmitter);


/**
 * ```createChunk``` is used to construct a pre-allocated chunk to store up to ```length``` bytes of data.
 * The created chunk includes a prepended header for ```chunk_type``` of size ```self.headerSize```.
 *
 * @method createChunk
 * @param msg_type
 * @param chunk_type {String} chunk type. should be 'F' 'C' or 'A'
 * @param length
 * @return {Buffer} a buffer object with the required length representing the chunk.
 *
 * Note:
 *  - only one chunk can be created at a time.
 *  - a created chunk should be committed using the ```write``` method before an other one is created.
 */
TCP_transport.prototype.createChunk = function (msg_type, chunk_type, length) {

    assert(msg_type === "MSG");
    assert(this._pending_buffer === undefined, "createChunk has already been called ( use write first)");

    var total_length = length + this.headerSize;
    var buffer = new Buffer(total_length);
    writeTCPMessageHeader("MSG", chunk_type, total_length, buffer);

    this._pending_buffer = buffer;

    return buffer;
};



TCP_transport.prototype._write_chunk = function (message_chunk) {

    if (this._socket) {
        this.bytesWritten += message_chunk.length;
        this._socket.write(message_chunk);
    }
};

/**
 * write the message_chunk on the socket.
 * @method write
 * @param message_chunk {Buffer}
 *
 * Notes:
 *  - the message chunk must have been created by ```createChunk```.
 *  - once a message chunk has been written, it is possible to call ```createChunk``` again.
 *
 */
TCP_transport.prototype.write = function (message_chunk) {

    assert((this._pending_buffer === undefined) || this._pending_buffer === message_chunk, " write should be used with buffer created by createChunk");

    var header = readRawMessageHeader(message_chunk);
    assert(header.length === message_chunk.length);
    assert(['F', 'C', 'A'].indexOf(header.messageHeader.isFinal) !== -1);

    this._write_chunk(message_chunk);

    this._pending_buffer = undefined;
};

TCP_transport.prototype._cleanup_timers = function () {

    var self = this;
    if (self._timerId) {
        clearTimeout(self._timerId);
        this._timerId = null;
    }
};


/**
 * @method _install_socket
 * @param socket {Socket}
 * @private
 */
TCP_transport.prototype._install_socket = function (socket) {
    var self = this;

    assert(socket);

    self._socket = socket;

    self.packetAssembler = undefined;

    self._socket.on("data", function (data) {

        self.bytesRead += data.length;
        if (self._on_data_received) {
            self._on_data_received(data);
        }

    }).on('close', function (had_error) {
        // xx console.log("SOCKET close : had error".red, had_error.toString().cyan);
    }).on('end', function (err) {
        // received when the other end of the socket sends a FIN packet.
        if (self._on_socket_ended) {
            self._on_socket_ended(err);
        }

    }).on('error', function (err) {

        // node The 'close' event will be called directly following this event.

        debugLog("SOCKET Error : " + err);
        if (self._on_socket_error) {
            self._on_socket_error(err);
        }
    });

};

TCP_transport.prototype._install_one_time_message_receiver = function (callback) {

    var self = this;

    assert(!self._timerId);
    assert(!self._on_data_received);
    assert(!self._on_socket_ended);
    assert(!self._on_socket_error);

    var the_callback = callback;

    function _fulfill_pending_promises(err, data) {
        self._on_socket_error = null;
        self._on_data_received = null;
        self._on_socket_ended = null;
        self._cleanup_timers();
        if (the_callback) {
            the_callback(err, data);
        }
        the_callback = null;
    }

    self._timerId = setTimeout(function () {
        _fulfill_pending_promises(new Error("Timeout in waiting for data on socket"));
    }, self.timeout);

    self._on_data_received = function (data) {
        _fulfill_pending_promises(null, data);
    };
    self._on_socket_ended = function (err) {
        _fulfill_pending_promises(new Error("Connection aborted - ended by server : " + (err ? err.message : "")));
    };
    self._on_socket_error = function (err) {
        _fulfill_pending_promises(new Error("Connection aborted - error on socket : " + (err ? err.message : "")));
    };

};



/**
 * disconnect the TCP layer and close the underlying socket.
 * The ```"close"``` event will be emitted to the observers with err=null.
 *
 * @method disconnect
 * @async
 * @param callback
 */
TCP_transport.prototype.disconnect = function (callback) {

    var self = this;
    if (self.__disconnecting__) {
        callback();
        return;
    }

    assert(_.isFunction(callback), "expecting a callback function, but got " + callback);
    assert(!self.__disconnecting__, "TCP Transport has already been disconnected");

    self.__disconnecting__ = true;

    self._cleanup_timers();

    // stop all action on sockets
    self._on_data_received = null;
    self._on_socket_ended = null;
    self._on_socket_error = null;


    if (self._socket) {
        self._socket.destroy();
        self._socket.end();
        self._socket = null;
    }
    setImmediate(function () {
        self.__disconnecting__ = true;

        self.emit("close", null);
        callback();
    });

};


TCP_transport.prototype._install_packet_assembler = function () {

    var self = this;

    assert(!self._on_data_received);
    assert(!self._on_socket_ended);
    assert(!self._on_socket_error);

    // ready to receive and send data
    self.packetAssembler = new PacketAssembler({
        readMessageFunc: readRawMessageHeader
    });
    self.packetAssembler.on("message", function (message_chunk) {
        /**
         * notify the observers that a message chunk has been received
         * @event message
         * @param message_chunk {Buffer} the message chunk
         */
        self.emit("message", message_chunk);
    });

    self._on_data_received = function on_data_received_for_packet_assembler(data) {
        assert(self.packetAssembler);
        if (data.length > 0) {
        self.packetAssembler.feed(data);
    }
};

self._on_socket_ended = function on_socket_ended_by_external_source(err) {

        self._on_socket_ended = null;
        self._on_data_received = null;
        self._on_socket_error = null;

        debugLog('Transport Connection ended'.red);
        assert(!self.__disconnecting__);
        err = err || new Error("_socket has been disconnected by third party");
        /**
         * notify the observers that the transport layer has been disconnected.
         * @event close
         * @param err the Error object or null
         */
        self.emit("close", err);
        self.__disconnecting__ = true;

        debugLog(" bytesRead    = ", self.bytesRead);
        debugLog(" bytesWritten = ", self.bytesWritten);

    };

};

exports.TCP_transport = TCP_transport;
