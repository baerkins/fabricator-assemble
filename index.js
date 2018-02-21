// modules
var _ = require('lodash');
var beautifyHtml = require('js-beautify').html;
var chalk = require('chalk');
var fs = require('fs');
var globby = require('globby');
var Handlebars = require('handlebars');
var inflect = require('i')();
var matter = require('gray-matter');
var md = require('markdown-it')({ html: true, linkify: true });
var mkdirp = require('mkdirp');
var path = require('path');
var sortObj = require('sort-object');
var yaml = require('js-yaml');


/**
 * Default options
 * @type {Object}
 */
var defaults = {
	/**
	 * ID (filename) of default layout
	 * @type {String}
	 */
	layout: 'default',

	/**
	 * ID (filename) of default layout
	 * @type {String}
	 */
	blocksLayout: 'blocks',

	/**
	 * Layout templates
	 * @type {(String|Array)}
	 */
	layouts: ['src/views/layouts/*'],

	/**
	 * Layout includes (partials)
	 * @type {String}
	 */
	layoutIncludes: ['src/views/layouts/includes/*'],

	/**
	 * Pages to be inserted into a layout
	 * @type {(String|Array)}
	 */
	views: ['src/views/**/*', '!src/views/+(layouts)/**'],

	/**
	 * Materials - snippets turned into partials
	 * @type {(String|Array)}
	 */
	materials: ['src/materials/**/*'],

	/**
	 * Materials - snippets turned into partials
	 * @type {(String|Array)}
	 */
	materialBlocks: ['src/material-blocks/**/*'],

	/**
	 * Materials - snippets turned into partials
	 * @type {(String|Array)}
	 */
	materialPartials: ['src/materials/**/*', 'src/material-blocks/**/*'],

	/**
	 * JSON or YAML data models that are piped into views
	 * @type {(String|Array)}
	 */
	data: ['src/data/**/*.{json,yml}'],

	/**
	 * Markdown files containing toolkit-wide documentation
	 * @type {(String|Array)}
	 */
	docs: ['src/docs/**/*.md'],

	/**
	 * Keywords used to access items in views
	 * @type {Object}
	 */
	keys: {
		materialPartials: 'materialpartials',
		materials: 'materials',
		materialBlocks: 'materialblocks',
		views: 'views',
		docs: 'docs'
	},

	/**
	 * Location to write files
	 * @type {String}
	 */
	dest: 'dist',

	/**
	 * beautifier options
	 * @type {Object}
	 */
	beautifier: {
		indent_size: 1,
		indent_char: '	',
		indent_with_tabs: true
	},

	/**
	 * Function to call when an error occurs
	 * @type {Function}
	 */
	onError: null,

	/**
	 * Whether or not to log errors to console
	 * @type {Boolean}
	 */
	logErrors: false
};


/**
 * Merged defaults and user options
 * @type {Object}
 */
var options = {};


/**
 * Assembly data storage
 * @type {Object}
 */
var assembly = {
	/**
	 * Contents of each layout file
	 * @type {Object}
	 */
	layouts: {},

	/**
	 * Parsed JSON data from each data file
	 * @type {Object}
	 */
	data: {},

	/**
	 * Meta data for materials, grouped by "collection" (sub-directory); contains name and sub-items
	 * @type {Object}
	 */
	materials: {},

	/**
	 * Meta data for materials, grouped by "collection" (sub-directory); contains name and sub-items
	 * @type {Object}
	 */
	materialBlocks: {},

	/**
	 * Meta data for materials, grouped by "collection" (sub-directory); contains name and sub-items
	 * @type {Object}
	 */
	materialPartials: {},

	/**
	 * Each material's front-matter data
	 * @type {Object}
	 */
	materialData: {},

	/**
	 * Each material's front-matter data
	 * @type {Object}
	 */
	materialBlocksData: {},

	/**
	 * Meta data for user-created views (views in views/{subdir})
	 * @type {Object}
	 */
	views: {},

	/**
	 * Meta data (name, sub-items) for doc file
	 * @type {Object}
	 */
	docs: {}
};


/**
 * Get the name of a file (minus extension) from a path
 * @param  {String} filePath
 * @example
 * './src/materials/structures/foo.html' -> 'foo'
 * './src/materials/structures/02-bar.html' -> 'bar'
 * @return {String}
 */
var getName = function (filePath, preserveNumbers) {
	// get name; replace spaces with dashes
	var name = path.basename(filePath, path.extname(filePath)).replace(/\s/g, '-');
	return (preserveNumbers) ? name : name.replace(/^[0-9|\.\-]+/, '');

};


/**
 * Attempt to read front matter, handle errors
 * @param  {String} file Path to file
 * @return {Object}
 */
var getMatter = function (file) {
	return matter.read(file, {
		parser: require('js-yaml').safeLoad
	});
};


/**
 * Handle errors
 * @param  {Object} e Error object
 */
var handleError = function (e) {

	// default to exiting process on error
	var exit = true;

	// construct error object by combining argument with defaults
	var error = _.assign({}, {
		name: 'Error',
		reason: '',
		message: 'An error occurred',
	}, e);

	// call onError
	if (_.isFunction(options.onError)) {
		options.onError(error);
		exit = false;
	}

	// log errors
	if (options.logErrors) {
		console.error(chalk.bold.red('Error (fabricator-assemble): ' + e.message + '\n'), e.stack);
		exit = false;
	}

	// break the build if desired
	if (exit) {
		console.error(chalk.bold.red('Error (fabricator-assemble): ' + e.message + '\n'), e.stack);
		process.exit(1);
	}

};


/**
 * Build the template context by merging context-specific data with assembly data
 * @param  {Object} data
 * @return {Object}
 */
var buildContext = function (data, hash) {

	// set keys to whatever is defined
	var materials = {};
	materials[options.keys.materials] = assembly.materials;

	var materialBlocks = {};
	materialBlocks[options.keys.materialBlocks] = assembly.materialBlocks;

	var materialPartials = {};
	materialPartials[options.keys.materialPartials] = assembly.materialPartials;

	var views = {};
	views[options.keys.views] = assembly.views;

	var docs = {};
	docs[options.keys.docs] = assembly.docs;

	return _.assign({}, data, assembly.data, assembly.materialData, materials, materialBlocks, assembly.materialBlocksData, materialPartials, views, docs, hash);

};


/**
 * Convert a file name to title case
 * @param  {String} str
 * @return {String}
 */
var toTitleCase = function (str) {
	return str.replace(/(\-|_)/g, ' ').replace(/\w\S*/g, function (word) {
		return word.charAt(0).toUpperCase() + word.substr(1).toLowerCase();
	});
};


/**
 * Insert the page into a layout
 * @param  {String} page
 * @param  {String} layout
 * @return {String}
 */
var wrapPage = function (page, layout) {
	// var regex = /\{\%\s?body\s?\%\}/;
	hasBody = layout.substring(0).search(/\{\%\s?body\s?\%\}/);
	if (hasBody < 0) {
		return layout;
	} else {
		return layout.replace(/\{\%\s?body\s?\%\}/, page);
	}
};

var replaceHtmlSpecialChars = function (str) {
	return String(str).
		replace(/&/g, '&amp;').
		replace(/</g, '&lt;').
		replace(/>/g, '&gt;').
		replace(/"/g, '&quot;').
		replace(/'/g, '&#039;');
}


/**
 * Parse each material - collect data, create partial
 */
var parseMaterialPartials = function () {

	// reset object
	assembly.materialPartials = {};

	// get files and dirs
	var files = globby.sync(options.materialPartials, { nodir: true, nosort: true });

	// build a glob for identifying directories
	options.materialPartials = (typeof options.materialPartials === 'string') ? [options.materialPartials] : options.materialPartials;
	var dirsGlob = options.materialPartials.map(function (pattern) {
		return path.dirname(pattern) + '/*/';
	});

	// get all directories
	// do a new glob; trailing slash matches only dirs
	var dirs = globby.sync(dirsGlob).map(function (dir) {
		return path.normalize(dir).split(path.sep).slice(-2, -1)[0];
	});


	// stub out an object for each collection and subCollection
	files.forEach(function (file) {

		var parent = getName(path.normalize(path.dirname(file)).split(path.sep).slice(-2, -1)[0], true);
		var collection = getName(path.normalize(path.dirname(file)).split(path.sep).pop(), true);
		var isSubCollection = (dirs.indexOf(parent) > -1);

		// get the material base dir for stubbing out the base object for each category (e.g. component, structure)
		var materialBase = (isSubCollection) ? parent : collection;

		// stub the base object
		assembly.materialPartials[materialBase] = assembly.materialPartials[materialBase] || {
			name: toTitleCase(getName(materialBase)),
			items: {}
		};

		if (isSubCollection) {
			assembly.materialPartials[parent].items[collection] = assembly.materialPartials[parent].items[collection] || {
				name: toTitleCase(getName(collection)),
				items: {}
			};
		}

	});


	// iterate over each file (material)
	files.forEach(function (file) {

		// get info
		var fileMatter = getMatter(file);
		var collection = getName(path.normalize(path.dirname(file)).split(path.sep).pop(), true);
		var parent = path.normalize(path.dirname(file)).split(path.sep).slice(-2, -1)[0];
		var isSubCollection = (dirs.indexOf(parent) > -1);
		var id = (isSubCollection) ? getName(collection) + '.' + getName(file) : getName(file);
		var key = (isSubCollection) ? collection + '.' + getName(file, true) : getName(file, true);

		// get material front-matter, omit `notes`
		var localData = _.omit(fileMatter.data, 'notes');

		// trim whitespace from material content
		var content = fileMatter.content.replace(/^(\s*(\r?\n|\r))+|(\s*(\r?\n|\r))+$/g, '');


		// capture meta data for the material
		if (!isSubCollection) {
			assembly.materialPartials[collection].items[key] = {
				name: toTitleCase(id),
				notes: (fileMatter.data.notes) ? md.render(fileMatter.data.notes) : '',
				data: localData
			};
		} else {
			assembly.materialPartials[parent].items[collection].items[key] = {
				name: toTitleCase(id.split('.')[1]),
				notes: (fileMatter.data.notes) ? md.render(fileMatter.data.notes) : '',
				data: localData
			};
		}


		// store material-name-spaced local data in template context
		assembly.materialData[id.replace(/\./g, '-')] = localData;


		// replace local fields on the fly with name-spaced keys
		// this allows partials to use local front-matter data
		// only affects the compilation environment
		if (!_.isEmpty(localData)) {
			_.forEach(localData, function (val, key) {
				// {{field}} => {{material-name.field}}
				var regex = new RegExp('(\\{\\{[#\/]?)(\\s?' + key + '+?\\s?)(\\}\\})', 'g');
				content = content.replace(regex, function (match, p1, p2, p3) {
					return p1 + id.replace(/\./g, '-') + '.' + p2.replace(/\s/g, '') + p3;
				});
			});
		}

		// register the partial
		Handlebars.registerPartial(id, content);

	});


	// sort materials object alphabetically
	assembly.materialPartials = sortObj(assembly.materialPartials, 'order');

	for (var collection in assembly.materialPartials) {
		assembly.materialPartials[collection].items = sortObj(assembly.materialPartials[collection].items, 'order');
	}

};





/**
 * Parse each material - collect data, create partial
 */
var parseMaterials = function () {

	// reset object
	assembly.materials = {};

	// get files and dirs
	var files = globby.sync(options.materials, { nodir: true, nosort: true });

	// build a glob for identifying directories
	options.materials = (typeof options.materials === 'string') ? [options.materials] : options.materials;
	var dirsGlob = options.materials.map(function (pattern) {
		return path.dirname(pattern) + '/*/';
	});

	// get all directories
	// do a new glob; trailing slash matches only dirs
	var dirs = globby.sync(dirsGlob).map(function (dir) {
		return path.normalize(dir).split(path.sep).slice(-2, -1)[0];
	});


	// stub out an object for each collection and subCollection
	files.forEach(function (file) {

		var parent = getName(path.normalize(path.dirname(file)).split(path.sep).slice(-2, -1)[0], true);
		var collection = getName(path.normalize(path.dirname(file)).split(path.sep).pop(), true);
		var isSubCollection = (dirs.indexOf(parent) > -1);

		// get the material base dir for stubbing out the base object for each category (e.g. component, structure)
		var materialBase = (isSubCollection) ? parent : collection;

		// stub the base object
		assembly.materials[materialBase] = assembly.materials[materialBase] || {
			name: toTitleCase(getName(materialBase)),
			items: {}
		};

		if (isSubCollection) {
			assembly.materials[parent].items[collection] = assembly.materials[parent].items[collection] || {
				name: toTitleCase(getName(collection)),
				items: {}
			};
		}

	});


	// iterate over each file (material)
	files.forEach(function (file) {

		// get info
		var fileMatter = getMatter(file);
		var collection = getName(path.normalize(path.dirname(file)).split(path.sep).pop(), true);
		var parent = path.normalize(path.dirname(file)).split(path.sep).slice(-2, -1)[0];
		var isSubCollection = (dirs.indexOf(parent) > -1);
		var id = (isSubCollection) ? getName(collection) + '.' + getName(file) : getName(file);
		var key = (isSubCollection) ? collection + '.' + getName(file, true) : getName(file, true);

		// get material front-matter, omit `notes`
		var localData = _.omit(fileMatter.data, 'notes');

		// trim whitespace from material content
		var content = fileMatter.content.replace(/^(\s*(\r?\n|\r))+|(\s*(\r?\n|\r))+$/g, '');


		// capture meta data for the material
		if (!isSubCollection) {
			assembly.materials[collection].items[key] = {
				name: toTitleCase(id),
				notes: (fileMatter.data.notes) ? md.render(fileMatter.data.notes) : '',
				data: localData
			};
		} else {
			assembly.materials[parent].items[collection].items[key] = {
				name: toTitleCase(id.split('.')[1]),
				notes: (fileMatter.data.notes) ? md.render(fileMatter.data.notes) : '',
				data: localData
			};
		}


		// store material-name-spaced local data in template context
		assembly.materialData[id.replace(/\./g, '-')] = localData;

	});


	// sort materials object alphabetically
	assembly.materialPartials = sortObj(assembly.materialPartials, 'order');

	for (var collection in assembly.materialPartials) {
		assembly.materialPartials[collection].items = sortObj(assembly.materialPartials[collection].items, 'order');
	}

};




/**
 * Parse markdown files as "docs"
 */
var parseDocs = function () {

	// reset
	assembly.docs = {};

	// get files
	var files = globby.sync(options.docs, { nodir: true });

	// iterate over each file (material)
	files.forEach(function (file) {

		var id = getName(file);

		// save each as unique prop
		assembly.docs[id] = {
			name: toTitleCase(id),
			content: md.render(fs.readFileSync(file, 'utf-8'))
		};

	});

};


/**
 * Parse layout files
 */
var parseLayouts = function () {

	// reset
	assembly.layouts = {};

	// get files
	var files = globby.sync(options.layouts, { nodir: true });

	// save content of each file
	files.forEach(function (file) {
		var id = getName(file);
		var content = fs.readFileSync(file, 'utf-8');
		assembly.layouts[id] = content;
	});

};


/**
 * Register layout includes has Handlebars partials
 */
var parseLayoutIncludes = function () {

	// get files
	var files = globby.sync(options.layoutIncludes, { nodir: true });

	// save content of each file
	files.forEach(function (file) {
		var id = getName(file);
		var content = fs.readFileSync(file, 'utf-8');
		Handlebars.registerPartial(id, content);
	});

};


/**
 * Parse data files and save JSON
 */
var parseData = function () {

	// reset
	assembly.data = {};

	// get files
	var files = globby.sync(options.data, { nodir: true });

	// save content of each file
	files.forEach(function (file) {
		var id = getName(file);
		var content = yaml.safeLoad(fs.readFileSync(file, 'utf-8'));
		assembly.data[id] = content;
	});

};


/**
 * Get meta data for views
 */
var parseViews = function () {

	// reset
	assembly.views = {};

	// get files
	var files = globby.sync(options.views, { nodir: true });

	files.forEach(function (file) {

		var id = getName(file, true);

		// determine if view is part of a collection (subdir)
		var dirname = path.normalize(path.dirname(file)).split(path.sep).pop(),
			collection = (dirname !== options.keys.views) ? dirname : '';

		var fileMatter = getMatter(file),
			fileData = _.omit(fileMatter.data, 'notes');

		// if this file is part of a collection
		if (collection) {

			// create collection if it doesn't exist
			assembly.views[collection] = assembly.views[collection] || {
				name: toTitleCase(collection),
				items: {}
			};

			// store view data
			assembly.views[collection].items[id] = {
				name: toTitleCase(id),
				data: fileData
			};

		}

	});

};




/**
 * Get meta data for views
 */
var parseMaterialBlocks = function () {

	// reset
	assembly.materialBlocks = {};

	// get files
	var files = globby.sync(options.materialBlocks, { nodir: true });

	files.forEach(function (file) {

		var id = getName(file, true);

		// determine if view is part of a collection (subdir)
		var dirname = path.normalize(path.dirname(file)).split(path.sep).pop(),
			collection = (dirname !== options.keys.materialBlocks) ? dirname : '';

		var fileMatter = getMatter(file),
			fileData = _.omit(fileMatter.data, 'notes');
		fileData.fabricator = true;

		// if this file is part of a collection
		if (collection) {

			// create collection if it doesn't exist
			assembly.materialBlocks[collection] = assembly.materialBlocks[collection] || {
				name: toTitleCase(collection),
				items: {}
			};

			// store view data
			assembly.materialBlocks[collection].items[id] = {
				name: toTitleCase(id),
				data: fileData
			};

		}

	});


};



/**
 * Register new Handlebars helpers
 */
var registerHelpers = function () {

	// get helper files
	var resolveHelper = path.join.bind(null, __dirname, 'helpers');
	var localHelpers = fs.readdirSync(resolveHelper());
	var userHelpers = options.helpers;



	// register local helpers
	localHelpers.map(function (helper) {
		var key = helper.match(/(^\w+?-)(.+)(\.\w+)/)[2];
		var path = resolveHelper(helper);
		Handlebars.registerHelper(key, require(path));
	});


	// register user helpers
	for (var helper in userHelpers) {
		if (userHelpers.hasOwnProperty(helper)) {
			Handlebars.registerHelper(helper, userHelpers[helper]);
		}
	}


	Handlebars.registerHelper('toJSON', function (object) {
		return new Handlebars.SafeString(JSON.stringify(object));
	});

	/**
	 * `material`
	 * @description Like a normal partial include (`{{> partialName }}`),
	 * but with some additional templating logic to help with nested block iterations.
	 * The name of the helper is the singular form of whatever is defined as the `options.keys.materials`
	 * @example
	 * {{material name context}}
	 */
	Handlebars.registerHelper('prettyHTML', function (content) {

		return beautifyHtml(content, options.beautifier);

	});




	/**
	 * Helpers that require local functions like `buildContext()`
	 */

	/**
	 * `material`
	 * @description Like a normal partial include (`{{> partialName }}`),
	 * but with some additional templating logic to help with nested block iterations.
	 * The name of the helper is the singular form of whatever is defined as the `options.keys.materials`
	 * @example
	 * {{material name context}}
	 */
	Handlebars.registerHelper(inflect.singularize(options.keys.materials), function (name, context, opts) {

		// remove leading numbers from name keyword
		// partials are always registered with the leading numbers removed
		// This is for both the subCollection as the file(name) itself!
		var key = name.replace(/(\d+[\-\.])+/, '').replace(/(\d+[\-\.])+/, '');

		// attempt to find pre-compiled partial
		var template = Handlebars.partials[key],
			fn;

		// compile partial if not already compiled
		if (!_.isFunction(template)) {
			fn = Handlebars.compile(template);
		} else {
			fn = template;
		}

		// return beautified html with trailing whitespace removed
		return beautifyHtml(fn(buildContext(context, opts.hash)).replace(/^\s+/, ''), options.beautifier);

	});

};


/**
 * Setup the assembly
 * @param  {Objet} options  User options
 */
var setup = function (userOptions) {

	// merge user options with defaults
	options = _.merge({}, defaults, userOptions);

	// setup steps
	registerHelpers();
	parseLayouts();
	parseLayoutIncludes();
	parseData();
	parseMaterialPartials();
	parseMaterials();
	parseMaterialBlocks();
	parseViews();
	parseDocs();

};


/**
 * Assemble views using materials, data, and docs
 */
var assemble = function () {

	// get files
	// var filePile = _.merge(options.views, options.materialBlocks);
	// console.log(filePile);
	var views = globby.sync(options.views, { nodir: true });
	var blocks = globby.sync(options.materialBlocks, { nodir: true });
	var files = views.concat(blocks);

	// create output directory if it doesn't already exist
	mkdirp.sync(options.dest);

	// iterate over each view
	files.forEach(function (file) {

		var id = getName(file);

		// build filePath
		var dirname = path.normalize(path.dirname(file)).split(path.sep).pop(),
			type = path.normalize(path.dirname(file)).split(path.sep)[1],
			name = collection = (dirname !== options.keys.views) ? dirname : '',
			filePath = path.normalize(path.join(options.dest, collection, path.basename(file))),
			basename = path.basename(file, '.html');

		// get page gray matter and content
		var pageMatter = getMatter(file),
			pageContent = pageMatter.content;

		if (collection) {
			pageMatter.data.baseurl = '..';
		}

		// template using Handlebars
		if (type === 'material-blocks') {

			var htmlContent = Handlebars.compile(pageContent);

			pageMatter.data['name'] = pageMatter.data['name'] ? pageMatter.data['name'] : toTitleCase(basename);
			pageMatter.data['block-markup'] = htmlContent();

			var source = wrapPage(pageContent, assembly.layouts['blocks']),
				context = buildContext(pageMatter.data),
				template = Handlebars.compile(source);



		} else {
			var source = wrapPage(pageContent, assembly.layouts[pageMatter.data.layout || options.layout]),
				context = buildContext(pageMatter.data),
				template = Handlebars.compile(source);
		}


		// redefine file path if dest front-matter variable is defined
		if (pageMatter.data.dest) {
			filePath = path.normalize(pageMatter.data.dest);
		}

		// change extension to .html
		filePath = filePath.replace(/\.[0-9a-z]+$/, '.html');

		// write file
		mkdirp.sync(path.dirname(filePath));
		fs.writeFileSync(filePath, template(context));

		// write a copy file if custom dest-copy front-matter variable is defined
		if (pageMatter.data['dest-copy']) {
			var copyPath = path.normalize(pageMatter.data['dest-copy']);
			mkdirp.sync(path.dirname(copyPath));
			fs.writeFileSync(copyPath, template(context));
		}
	});

};


/**
 * Module exports
 * @return {Object} Promise
 */
module.exports = function (options) {

	try {

		// setup assembly
		setup(options);

		// assemble
		assemble();

	} catch (e) {
		handleError(e);
	}

};
