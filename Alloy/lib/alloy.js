/**
 * @class Alloy
 * Top-level module for Alloy functions.
 *
 */
var 	   _ = require('alloy/underscore')._,
	Backbone = require('alloy/backbone'),
	CONST = require('alloy/constants');

var DEFAULT_WIDGET = 'widget';

exports.version = '1.2.0';
exports._ = _;
exports.Backbone = Backbone;

function ucfirst(text) {
    if (!text) { return text; }
    return text[0].toUpperCase() + text.substr(1);
};

function addNamespace(apiName) {
	return (CONST.IMPLICIT_NAMESPACES[apiName] || CONST.NAMESPACE_DEFAULT) + 
		'.' + apiName;
}

exports.M = function(name, modelDesc, migrations) {
	var config = (modelDesc || {}).config || {};
	var adapter = config.adapter || {};
	var extendObj = {};
	var extendClass = {};
	var mod;

	if (adapter.type) {
		mod = require('alloy/sync/' + adapter.type);
		extendObj.sync = function(method, model, opts) {
			mod.sync(method, model, opts);
		};
	} else {
		extendObj.sync = function(method, model, opts) {
			Ti.API.warn('Execution of ' + method + '#sync() function on a model that does not support persistence');
			Ti.API.warn('model: ' + JSON.stringify(model.toJSON()));
		};
	}
	extendObj.defaults = config.defaults;

	// construct the model based on the current adapter type
	if (migrations) { extendClass.migrations = migrations; }

	// Run the pre model creation code, if any
    if (mod && _.isFunction(mod.beforeModelCreate)) {
    	config = mod.beforeModelCreate(config, name) || config;
    }

	// Create the Model object
	var Model = Backbone.Model.extend(extendObj, extendClass);
	Model.prototype.config = config;

	// Extend the Model with extendModel(), if defined
	if (_.isFunction(modelDesc.extendModel)) {
		Model = modelDesc.extendModel(Model) || Model;
	}

	// Run the post model creation code, if any
	if (mod && _.isFunction(mod.afterModelCreate)) {
		mod.afterModelCreate(Model, name);
	}

	return Model;
};

exports.C = function(name, modelDesc, model) {
	var extendObj = { model: model };
	var config = (model ? model.prototype.config : {}) || {};
	var mod;

	if (config.adapter && config.adapter.type) {
		mod = require('alloy/sync/' + config.adapter.type);
		extendObj.sync = function(method, model, opts) {
			mod.sync(method,model,opts);
		};
	} else {
		extendObj.sync = function(method, model, opts) {
			Ti.API.warn('Execution of ' + method + '#sync() function on a collection that does not support persistence');
			Ti.API.warn('model: ' + JSON.stringify(model.toJSON()));
		};
	}

	var Collection = Backbone.Collection.extend(extendObj);
	Collection.prototype.config = config;

	// extend the collection object
	if (_.isFunction(modelDesc.extendCollection)) {
		Collection = modelDesc.extendCollection(Collection) || Collection;
	}

	// do any post collection creation code form the sync adapter
	if (mod && _.isFunction(mod.afterCollectionCreate)) { 
		mod.afterCollectionCreate(Collection); 
	}

	return Collection;
};

exports.UI = {};
exports.UI.create = function(controller, apiName, opts) {
	opts || (opts = {});

	// Make sure we have a full api name
	var baseName, ns;
	var parts = apiName.split('.');
	if (parts.length === 1) {
		baseName = apiName;
		ns = opts.ns || CONST.IMPLICIT_NAMESPACES[baseName] || CONST.NAMESPACE_DEFAULT;
	} else if (parts.length > 1) {
		baseName = parts[parts.length-1];
		ns = parts.slice(0,parts.length-1).join('.');
	} else {
		throw('Alloy.UI.create() failed: No API name was given in the second parameter');
	}
	opts.apiName = ns + '.' + baseName;
	baseName = baseName[0].toUpperCase() + baseName.substr(1);

	// generate the style object
	var style = exports.createStyle(controller, opts);

	// create the titanium proxy object
	return eval(ns)['create' + baseName](style);
}

exports.createStyle = function(controller, opts) {
	var classes, apiName;

	// If there's no opts, there's no reason to load the style module. Just
	// return an empty object.
	if (!opts) { return {}; }

	// make opts.classes an array if it isn't already
	if (_.isArray(opts.classes)) {
		classes = opts.classes.slice(0);
	} else if (_.isString(opts.classes)) {
		classes = opts.classes.split(/\s+/);
	} else {
		classes = [];
	}

	// give opts.apiName a namespace if it doesn't have one already
	apiName = opts.apiName;
	if (apiName && apiName.indexOf('.') === -1) {
		apiName = addNamespace(apiName);
	}

	// TODO: check cached styles based on opts and controller

	// Load the runtime style for the given controller
	var styleArray;
	if (controller && _.isObject(controller)) {
		styleArray = require('alloy/widgets/' + controller.widgetId + 
			'/styles/' + controller.name);
	} else {
		styleArray = require('alloy/styles/' + controller)
	}
	var styleFinal = {};

	// iterate through all styles
	var i, len;
	for (i = 0, len = styleArray.length; i < len; i++) {
		var style = styleArray[i];

		// give the apiName a namespace if necessary
		var styleApi = style.key;
		if (style.isApi && styleApi.indexOf('.') === -1) {
			styleApi = (CONST.IMPLICIT_NAMESPACES[styleApi] || 
				CONST.NAMESPACE_DEFAULT) + '.' + styleApi;
		}

		// does this style match the given opts?
		if ((style.isId && opts.id && style.key === opts.id) ||
			(style.isClass && _.contains(classes, style.key))) {
			// do nothing here, keep on processing
		} else if (style.isApi) {
			if (style.key.indexOf('.') === -1) {
				style.key = addNamespace(style.key);
			} 
			if (style.key !== apiName) { continue; }
		} else {
			// no matches, skip this style
			continue;
		}

		// can we clear out any form factor queries?
		if (style.queries && style.queries.formFactor && 
			!Alloy[style.queries.formFactor]) {
			continue;
		}

		// Merge this style into the existing style object
		_.extend(styleFinal, style.style);
	}

	// TODO: cache the style based on the opts and controller

	// Merge remaining extra style properties from opts, if any
	var extraStyle = _.omit(opts, [
		CONST.CLASS_PROPERTY,
		CONST.APINAME_PROPERTY
	]);
	_.extend(styleFinal, extraStyle);
	styleFinal[CONST.CLASS_PROPERTY] = classes;
	styleFinal[CONST.APINAME_PROPERTY] = apiName;

	return styleFinal;
};

function processStyle(controller, proxy, classes, opts) {
	opts || (opts = {});
	opts.classes = classes;
	proxy.apiName && (opts.apiName = proxy.apiName);
	proxy.id && (opts.id = proxy.id);
	proxy.applyProperties(exports.createStyle(controller, opts));
	OS_ANDROID && (proxy.classes = classes);
}

exports.addClass = function(controller, proxy, classes, opts) {
	// make sure we actually have classes to add
	if (!classes) {
		opts && proxy.applyProperties(opts);
		return;
	} else {
		// create a union of the existing classes with the new one(s)
		var pClasses = proxy[CONST.CLASS_PROPERTY] || [];
		var beforeLen = pClasses.length;
		classes = _.isString(classes) ? classes.split(/\s+/) : classes;
		var newClasses = _.union(pClasses, classes || []);
		
		// make sure we actually added classes before processing styles
		if (beforeLen === newClasses.length) {
			opts && proxy.applyProperties(opts);
			return;
		} else {
			processStyle(controller, proxy, newClasses, opts);
		}
	}
}

exports.removeClass = function(controller, proxy, classes, opts) {
	classes || (classes = []);
	var pClasses = proxy[CONST.CLASS_PROPERTY] || [];
	var beforeLen = pClasses.length;

	// make sure there's classes to remove before processing
	if (!beforeLen || !classes.length) {
		opts && proxy.applyProperties(opts);
		return;
	} else {
		// remove the given class(es)
		classes = _.isString(classes) ? classes.split(/\s+/) : classes;
		var newClasses = _.difference(pClasses, classes);

		// make sure there was actually a difference before processing
		if (beforeLen === newClasses.length) {
			opts && proxy.applyProperties(opts);
			return;
		} else {
			processStyle(controller, proxy, newClasses, opts);
		}
	}
}

exports.resetClass = function(controller, proxy, classes, opts) {
	classes || (classes = []);
	classes = _.isString(classes) ? classes.split(/\s+/) : classes;
	processStyle(controller, proxy, classes, opts);
}

/**
 * @method createWidget
 * Factory method for instantiating a widget controller. Creates and returns an instance of the
 * named widget.
 * @param {String} id Id of widget to instantiate.
 * @param {String} [name="widget"] Name of the view within the widget to instantiate ('widget' by default)
 * @param {Object} [args] Arguments to pass to the widget.
 * @return {Alloy.Controller} Alloy widget controller object.
 */
exports.createWidget = function(id, name, args) {
	if (typeof name !== 'undefined' && name !== null && 
		_.isObject(name) && !_.isString(name)) {
		args = name;
		name = DEFAULT_WIDGET;
	}
	return new (require('alloy/widgets/' + id + '/controllers/' + (name || DEFAULT_WIDGET)))(args);
}

/**
 * @method createController
 * Factory method for instantiating a controller. Creates and returns an instance of the
 * named controller.
 * @param {String} name Name of controller to instantiate.
 * @param {Object} [args] Arguments to pass to the controller.
 * @return {Alloy.Controller} Alloy controller object.
 */
exports.createController = function(name, args) {
	return new (require('alloy/controllers/' + name))(args);
}

/**
 * @method createModel
 * Factory method for instantiating a Backbone Model object. Creates and returns an instance of the
 * named model.
 *
 * See [Backbone.Model](http://backbonejs.org/#Model) in the Backbone.js documentation for
 * information on the methods and properties provided by the Model object.
 * @param {String} name Name of model to instantiate.
 * @param {Object} [args] Arguments to pass to the model.
 * @return {Backbone.Model} Backbone model object.
 */
exports.createModel = function(name, args) {
	return new (require('alloy/models/' + ucfirst(name)).Model)(args);
}

/**
 * @method createCollection
 * Factory method for instantiating a Backbone collection of model objects. Creates and returns a
 * collection for holding the named type of model objects.
 *
 * See [Backbone.Collection](http://backbonejs.org/#Collection) in the Backbone.js
 * documentation for  information on the methods and  properties provided by the
 * Collection object.
 * @param {String} name Name of model to hold in this collection.
 * @param {Object} [args] Arguments to pass to the collection.
 * @return {Backbone.Collection} Backbone collection object.
 */
exports.createCollection = function(name, args) {
	return new (require('alloy/models/' + ucfirst(name)).Collection)(args);
}

function isTabletFallback() {
	return !(Math.min(
		Ti.Platform.displayCaps.platformHeight,
		Ti.Platform.displayCaps.platformWidth
	) < 700);
}

/**
 * @property {Boolean} isTablet
 * `true` if the current device is a tablet.
 *
 */
exports.isTablet = (function() {
	if (OS_IOS) {
		return Ti.Platform.osname === 'ipad';
	} else if (OS_ANDROID) {
		var psc = Ti.Platform.Android.physicalSizeCategory;
		return psc === Ti.Platform.Android.PHYSICAL_SIZE_CATEGORY_LARGE ||
		       psc === Ti.Platform.Android.PHYSICAL_SIZE_CATEGORY_XLARGE;
	} else if (OS_MOBILEWEB) {
		return !(Math.min(
			Ti.Platform.displayCaps.platformHeight,
			Ti.Platform.displayCaps.platformWidth
		) < 400);
	} else if (OS_BLACKBERRY) {
		return (Ti.Platform.displayCaps.platformHeight === 600 &&
		       Ti.Platform.displayCaps.platformWidth === 1024) ||
			   (Ti.Platform.displayCaps.platformHeight === 1024 &&
		       Ti.Platform.displayCaps.platformWidth === 600);
	} else {
		return isTabletFallback();
	}
})();

/**
 * @property {Boolean} isHandheld
 * `true` if the current device is a handheld device (not a tablet).
 *
 */
exports.isHandheld = !exports.isTablet;

/**
 * @property {Object} Globals
 * An object for storing globally accessible variables and functions.
 * Alloy.Globals is accessible in any controller in your app:
 *
 *     Alloy.Globals.someGlobalObject = { key: 'value' };
 *     Alloy.Globals.someGlobalFunction = function(){};
 *
 * Alloy.Globals can be accessed in other non-controller Javascript files
 * like this:
 *
 *     var theObject = require('alloy').Globals.someGlobalObject;
 *
 */
exports.Globals = {};

/**
 * @property {Object} Models
 * An object for storing globally accessible Alloy models. Singleton models
 * created via markup will be stored on this object.
 *
 *     <Model src="myModel"/>
 *
 * The above markup would effectively generate the following code:
 *
 *     Alloy.Models.myModel = Alloy.createModel('MyModel');
 *
 * Alloy.Models.myModel would then be accessible in any controller in your app.
 *
 */
exports.Models = {};

/*
 * Creates a singleton instance of a Model based on the given model, or
 * returns an existing instance if one has already been created.
 * Documented in docs/apidoc/model.js for docs site.
 */
 exports.Models.instance = function(name) {
 	return exports.Models[name] || (exports.Models[name] = exports.createModel(name));
 };

/**
 * @property {Object} Collections
 * An object for storing globally accessible Alloy collections. Singleton collections
 * created via markup will be stored on this object.
 *
 *     <Collection src="myModel"/>
 *
 * The above markup would effectively generate the following code:
 *
 *     Alloy.Collections.myModel = Alloy.createCollection('MyModel');
 *
 * Alloy.Collections.myModel would then be accessible in any controller in your app.
 *
 */
exports.Collections = {};

/*
 * Creates a singleton instance of a Collection based on the given model, or
 * returns an existing instance if one has already been created.
 * Documented in docs/apidoc/collection.js for docs site.
 */
 exports.Collections.instance = function(name) {
 	return exports.Collections[name] || (exports.Collections[name] = exports.createCollection(name));
 };

/**
 * @property {Object} CFG
 * An object that stores Alloy configuration values as defined in your app's
 * app/config.json file. Here's what a typical config.json file might look
 * like in an Alloy app.
 *
 *     {
 *         "global": { "key": "defaultValue", "anotherKey": 12345 },
 *         "env:development": {},
 *         "env:test": {},
 *         "env:production": {},
 *         "os:ios": { "key": "iosValue" },
 *         "os:android": { "key": "androidValue" },
 *         "dependencies": {}
 *     }
 *
 * If this app was compiled for iOS, the Alloy.CFG would look like this:
 *
 *     Alloy.CFG = {
 *         "key": "iosValue",
 *         "anotherKey": 12345
 *     }
 *
 * Alloy.CFG is accessible in any controller in your app, and can be accessed
 * in other non-controller Javascript files like this:
 *
 *     var theKey = require('alloy').CFG.key;
 *
 */
exports.CFG = require('alloy/CFG');

if (OS_ANDROID) {
	exports.Android = {};
	exports.Android.menuItemCreateArgs = ['itemId', 'groupId', 'title', 'order', 'actionView', 'checkable', 'checked', 'enabled', 'icon', 'showAsAction', 'titleCondensed', 'visible'];
}
