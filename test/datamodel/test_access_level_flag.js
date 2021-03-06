
var AccessLevelFlag = require("../../lib/datamodel/access_level").AccessLevelFlag;
var makeAccessLevel = require("../../lib/datamodel/access_level").makeAccessLevel;
var should = require("should");
var findBuiltInType = require("../../lib/misc/factories_builtin_types").findBuiltInType;
var assert = require("assert");
var factories = require("../../lib/misc/factories");

var _ = require("underscore");

var ObjWithAccessLevel_Schema = {

    id: factories.next_available_id(),
    name: "ObjWithAccessLevel",
    fields: [
        { name: "title" ,        fieldType: "UAString" },
        {
            name: "accessLevel"  , fieldType: "AccessLevelFlag"
        }
    ]
};
exports.ObjWithAccessLevel_Schema = ObjWithAccessLevel_Schema;
var ObjWithAccessLevel  = factories.registerObject(ObjWithAccessLevel_Schema,"tmp");
assert(_.isFunction(ObjWithAccessLevel));

describe("Testing AccessLevelFlag",function() {

    it("should create a acess level flags from a string",function() {

        makeAccessLevel("CurrentRead").value.should.equal(0x01);
        makeAccessLevel("CurrentWrite").value.should.equal(0x02);
        makeAccessLevel("CurrentRead | CurrentWrite").value.should.equal(0x03);
        makeAccessLevel("CurrentWrite | CurrentRead").value.should.equal(0x03);


        AccessLevelFlag.get(0x1).key.should.eql("CurrentRead");
        AccessLevelFlag.get(0x2).key.should.eql("CurrentWrite");
        AccessLevelFlag.get(0x3).key.should.eql("CurrentRead | CurrentWrite");


        makeAccessLevel(makeAccessLevel("CurrentRead")).value.should.equal(0x01);
    });
    it("should have a accessLevel Flag Basic Type",function() {
        _.isObject(findBuiltInType("AccessLevelFlag")).should.equal(true);
    });
    it("should create an object with access_level",function() {
        var o = new ObjWithAccessLevel();
        o.should.have.property("accessLevel");
        o.accessLevel.should.eql(AccessLevelFlag.get("CurrentRead | CurrentWrite"));
    });
    it("should create an object with access_level defined as a 'string'",function() {

        var o = new ObjWithAccessLevel({
            accessLevel: "HistoryWrite | SemanticChange"
        });
        o.should.have.property("accessLevel");
        o.accessLevel.should.eql(AccessLevelFlag.get("HistoryWrite | SemanticChange"));

    });

    it("should create an object with access_level defined as a Int8'",function() {

        var o = new ObjWithAccessLevel({
            accessLevel: 0x5
        });
        o.should.have.property("accessLevel");
        o.accessLevel.should.eql(AccessLevelFlag.get("CurrentRead | HistoryRead"));
    });

    it("should persist a accessLevel Flag",function(){

        var o = new ObjWithAccessLevel({

        });
        o.accessLevel.should.eql(AccessLevelFlag.get("CurrentRead | CurrentWrite"));

        var encode_decode_round_trip_test = require("../helpers/encode_decode_round_trip_test").encode_decode_round_trip_test;
        encode_decode_round_trip_test(o);


    });

    it("should provide a easy way to check if a flag is set or not",function(){

        var accessLevel = makeAccessLevel("CurrentWrite | CurrentRead");

        accessLevel.has("CurrentWrite").should.be.eql(true);
        accessLevel.has("CurrentRead").should.be.eql(true);
        accessLevel.has("HistoryRead").should.be.eql(false);

    });
});