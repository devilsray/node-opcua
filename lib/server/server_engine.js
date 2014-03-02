var NodeClass = require("../../lib/browse_service").NodeClass;

var NodeId = require("../../lib/nodeid").NodeId;
var resolveNodeId = require("../../lib/nodeid").resolveNodeId;
var makeNodeId = require("../../lib/nodeid").makeNodeId;
var assert = require('better-assert');
var s = require("../../lib/structures");

var browse_service = require("../../lib/browse_service");
var BrowseDirection = browse_service.BrowseDirection;

var ReferenceType = require("../../lib/common/address_space").ReferenceType;


var read_service = require("../../lib/read_service");
var AttributeIds = read_service.AttributeIds;

var subscription_service = require("../../lib/subscription_service");

var DataValue = require("../datavalue").DataValue;
var Variant = require("../variant").Variant;
var DataType = require("../variant").DataType;
var VariantArrayType  = require("../variant").VariantArrayType;


var util = require("util");

var HasTypeDefinition = resolveNodeId("i=40");

var StatusCodes = require("../../lib/opcua_status_code").StatusCodes;

var coerceQualifyName = s.coerceQualifyName;
var coerceLocalizedText = s.coerceLocalizedText;

var _ = require("underscore");

var address_space = require("../../lib/common/address_space");
var generate_address_space = require("../../lib/common/load_nodeset2").generate_address_space;

var AddressSpace = address_space.AddressSpace;
var VariableIds = require("../../lib/opcua_node_ids").Variable;


/**
 *
 * @param address_space
 */
function make_back_references(address_space) {
    _.forEach(address_space._nodeid_index,function(node) {
        node.propagate_back_references(address_space);
    });
}



/**
 *
 * @param options:
 *      {
 *          nodeset_filename:  <filename> (optional) default : mini.Node.Set2.xml
 *      }
 * @constructor
 */
function ServerEngine() {

    this._private_namespace = 1;
    this._internal_id_counter = 1000;
    this._subscription_counter = 0;
    this._subscriptions = [];

}

ServerEngine.prototype.initialize = function(options,callback) {

    var self = this;
    assert(!self.address_space); // check that 'initalize' has not been already called

    options = options || {};
    assert(_.isFunction(callback));

    var default_xmlFile1 = __dirname + "../../../code_gen/Opc.Ua.NodeSet2.xml";
    var default_xmlFile2 = __dirname+"/mini.Node.Set2.xml";
    options.nodeset_filename =  options.nodeset_filename || default_xmlFile2;

    self.address_space =  new AddressSpace();

    generate_address_space(self.address_space, options.nodeset_filename,function(){

        make_back_references(self.address_space);

        self.FolderTypeId = self.findObject("FolderType").nodeId;
        self.BaseDataVariableTypeId = self.findObject("BaseDataVariableType").nodeId;

        self.rootFolder = self.findObject('RootFolder');
        assert(self.rootFolder.readAttribute);




        // -------------------------------------------- install default get/put handler
        var server_NamespaceArray_Id =  makeNodeId(VariableIds.Server_NamespaceArray); // ns=0;i=2255
        self.bindVariable(server_NamespaceArray_Id,{
            get: function(){
                console.log(" READING server_NamespaceArray_Id");
                return new Variant({
                    dataType: DataType.String,
                    arrayType: VariantArrayType.Array,
                    value: ["aaa","bbb"]
                });
            },
            set: null // read only
        });


        setImmediate(callback);

    });

};


ServerEngine.prototype._build_new_NodeId = function () {
    var nodeId = makeNodeId(this._internal_id_counter, this._private_namespace);
    this._internal_id_counter += 1;
    return nodeId;
};

/**
 *
 * @param folder
 * @returns {UAObject hasTypeDefinition: FolderType }
 */
ServerEngine.prototype.getFolder = function(folder) {
    var self = this;

    assert(self.address_space instanceof AddressSpace); // initialize not called

    folder = self.address_space.findObject(folder) || folder;

    assert(folder.hasTypeDefinition.toString() === self.FolderTypeId.toString(), "expecting a Folder here " + folder);
    return folder;
};

/**
 *
 * @param parentFolder
 * @param options
 * @returns {*}
 */
ServerEngine.prototype.createFolder = function (parentFolder, options) {
    var self = this;
    assert(self.address_space instanceof AddressSpace); // initialize not called

    // coerce parent folder to an object
    parentFolder = self.getFolder(parentFolder);

    if (typeof options === "string") {
        options = { browseName: options };
    }

    options.nodeId = options.nodeId || this._build_new_NodeId();
    options.nodeClass  = NodeClass.Object;
    options.references = [
        { referenceType: "HasTypeDefinition",isForward:true , nodeId: this.FolderTypeId   },
        { referenceType: "Organizes"        ,isForward:false, nodeId: parentFolder.nodeId }
    ];

    var folder = self.address_space._createObject(options);

    folder.propagate_back_references(this.address_space);
    assert( folder.parent === parentFolder.nodeId);

    return folder;
};

/**
 *
 * @param nodeId
 * @returns {BaseNode}
 */
ServerEngine.prototype.findObject = function(nodeId) {
    var self = this;
    assert(self.address_space instanceof AddressSpace); // initialize not called
    return self.address_space.findObject(nodeId);
};

/**
 *
 * @param nodeId
 * @returns {BaseNode}
 */
ServerEngine.prototype.findNodeIdByBrowseName = function(browseName) {
    var self = this;
    assert(self.address_space instanceof AddressSpace); // initialize not called
    var obj = self.address_space.findByBrowseName(browseName);
    return obj ? obj.nodeId: null;

};

/**
 *
 * @param parentFolder
 * @param options
 *        {
 *           browseName: "<some name>" //  [Mandatory] Variable Browse Name
 *           nodeId: somename || null // [optional]
 *           value:  {
 *              get : function() {
  *                return Variant({...});
  *             },
 *              set : function(variant) {
 *                // store
 *                return StatsCodes.Good;
 *              }
 *           }
 *           description: "<some text" // [optional]
 *        }
 * @returns {Variable}
 */
ServerEngine.prototype.addVariableInFolder = function (parentFolder, options) {
    var self = this;
    assert(self.address_space instanceof AddressSpace); // initialize not called
    assert(options.hasOwnProperty("browseName"));

    parentFolder = this.getFolder(parentFolder);

    var browseName = options.browseName;
   // xx var value = options.value;

    var newNodeId = options.nodeId || this._build_new_NodeId();

    var variable = this.address_space._createObject({
        nodeId: newNodeId,
        nodeClass: NodeClass.Variable,
        browseName: browseName,
        //xx value: value,
        references: [
            { referenceType: "HasTypeDefinition",isForward:true , nodeId: this.BaseDataVariableTypeId   },
            { referenceType: "Organizes"        ,isForward:false, nodeId: parentFolder.nodeId }
        ]
    });

    variable.propagate_back_references(this.address_space);

    variable.bindVariable(options.value);
    return variable;
};


/**
 *
 * @param nodeId
 * @param browseDirection
 * @returns {exports.BrowseResult}
 */
ServerEngine.prototype.browseSingleNode = function (nodeId, browseDescription) {
    var self = this;
    assert(self.address_space instanceof AddressSpace); // initialize not called


    browseDescription = browseDescription || {};

    // coerce nodeToBrowse to NodeId
    nodeId = resolveNodeId(nodeId);
    assert(nodeId instanceof NodeId);
    var obj = this.findObject(nodeId);

    var browseResult = {
        statusCode: StatusCodes.Good,
        continuationPoint: null,
        references: null
    };

    // check if referenceTypeId is correct
    if (browseDescription.referenceTypeId instanceof NodeId ) {
        if (browseDescription.referenceTypeId.value === 0 ) {
            browseDescription.referenceTypeId = null;
        } else {
            var rf = this.findObject(browseDescription.referenceTypeId);
            if (!rf || !(rf instanceof ReferenceType) ) {
                browseResult.statusCode = StatusCodes.Bad_ReferenceTypeIdInvalid;
                return new browse_service.BrowseResult(browseResult);
            }
            browseDescription.referenceTypeId=  rf.browseName;

        }
    }

    if (!obj) {
        // Object Not Found
        browseResult.statusCode = StatusCodes.Bad_NodeIdUnknown;
    } else {
        browseResult.statusCode = StatusCodes.Good;
        browseResult.references = obj.browseNode(this,browseDescription);
    }
    return new browse_service.BrowseResult(browseResult);
};

/**
 *
 * @param nodesToBrowse {Array of BrowseDescription}
 * @returns {Array of BrowseResult}
 */
ServerEngine.prototype.browse = function (nodesToBrowse) {
    var self = this;
    assert(self.address_space instanceof AddressSpace); // initialize not called
    assert(_.isArray(nodesToBrowse));

    var results = [];
    var self = this;
    nodesToBrowse.forEach(function (browseDescription) {
        var nodeId = resolveNodeId(browseDescription.nodeId);

        var r = self.browseSingleNode(nodeId, browseDescription);
        results.push(r);
    });
    return results;
};

/**
 *
 * @param nodeId
 * @param attributeId
 * @returns {*}
 */
ServerEngine.prototype.readSingleNode = function (nodeId, attributeId) {
    var self = this;
    assert(self.address_space instanceof AddressSpace); // initialize not called

    // coerce nodeToBrowse to NodeId
    nodeId = resolveNodeId(nodeId);
    assert(nodeId instanceof NodeId);
    var obj = this.findObject(nodeId);
    if (!obj) {
        // may be return Bad_NodeIdUnknown in dataValue instead ?
        // Object Not Found
        return new DataValue({ statusCode: StatusCodes.Bad_NodeIdUnknown });
    } else {
        // check access
        //    Bad_UserAccessDenied
        //    Bad_NotReadable
        // invalid attributes : Bad_NodeAttributesInvalid
        return obj.readAttribute(attributeId);
    }
};

/**
 *
 * @param nodesToRead {Array of ReadValueId}
 * @returns {Array of DataValue}
 */
ServerEngine.prototype.read = function (nodesToRead) {
    var self = this;
    assert(self.address_space instanceof AddressSpace); // initialize not called
    assert(_.isArray(nodesToRead));
    var dataValues = nodesToRead.map(function (readValueId) {
        var nodeId = readValueId.nodeId;
        var attributeId = readValueId.attributeId;
        var indexRange = readValueId.indexRange;
        var dataEncoding = readValueId.dataEncoding;
        return self.readSingleNode(nodeId, attributeId);
    });
    return dataValues;
};

/**
 *
 * @param writeValue
 * @returns {StatusCodes}
 */
ServerEngine.prototype.writeSingleNode = function (writeValue) {
    var self = this;
    assert(self.address_space instanceof AddressSpace); // initialize not called

    var nodeId = writeValue.nodeId;

    // coerce nodeToBrowse to NodeId
    nodeId = resolveNodeId(nodeId);
    assert(nodeId instanceof NodeId);
    var obj = this.findObject(nodeId);
    if (!obj) {
        return StatusCodes.Bad_NodeIdUnknown;
    } else {
        return obj.write(writeValue);
    }
};

/**
 *
 * @param write
 * @returns {Array of StatusCodes}
 */
ServerEngine.prototype.write = function (nodesToWrite) {
    var self = this;
    assert(self.address_space instanceof AddressSpace); // initialize not called

    var statusCodes = nodesToWrite.map(function (writeValue) {
        return self.writeSingleNode(writeValue);
    });
    assert(_.isArray(statusCodes));
    return statusCodes;
};


/**
 *
 * @param nodeId
 * @param options
 */
ServerEngine.prototype.bindVariable = function( nodeId, options ){
    options = options || {};

    assert(_.difference(["get","set"], _.keys(options)).length === 0);

    var obj = this.findObject(nodeId);
    if(obj && obj.bindVariable)  {
        obj.bindVariable(options);
    }
};


function Subscription() {

}
/**
 * create a new subscription
 * @return {Subscription}
 */
ServerEngine.prototype.createSubscription = function () {

    this._subscription_counter +=1;
    var id = this._subscription_counter;
    var subscription = new Subscription();
    subscription.id  = id;
    this._subscriptions[id] = subscription;
    return subscription;
};
/**
 * retrieve an existing subscription by subscriptionId
 * @param subscriptionId {Integer}
 * @return {Subscription}
 */
ServerEngine.prototype.getSubscription = function (subscriptionId) {
    return this._subscriptions[subscriptionId];
};
exports.ServerEngine = ServerEngine;
