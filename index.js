var $ = require('cheerio'),
	randomstring = require('randomstring'),
	Graph = require('graph.js/dist/graph.full.js'),
	request = require('request'),
	url = require('url');

var datastore = {
	domain: url.parse('https://getcarina.com'),
	map: new Graph()
};

function DynamicQueue(work) {
	this.maxWorkers = 10;
	this.queue = [];
	this.workers = {};
	this.workFunction = work;
}

DynamicQueue.prototype.push = function (item) {
	this.queue.push(item);

	if (Object.keys(this.workers).length > this.maxWorkers) {
		return;
	}

	console.log('Starting Worker...');
	var worker = new QueueProcessor(this);

	worker.run();

	this.workers[worker.id] = worker;
};

DynamicQueue.prototype.pop = function () {
	return this.queue.pop();
};

DynamicQueue.prototype.length = function () {
	return this.queue.length;
};

DynamicQueue.prototype.removeWorker = function (worker) {
	delete this.workers[worker.id];
};

function QueueProcessor(queue) {
	this.id = randomstring.generate(10);
	this._queue = queue;
}

QueueProcessor.prototype.run = function () {
	var self = this,
		item = this._queue.pop();

	if (!item) {
		this.die();
		return;
	}

	this._queue.workFunction(item, function () {
		self.run();
	});
};

QueueProcessor.prototype.die = function () {
	console.log('Stopping Worker...');
	this._queue.removeWorker(this);

	if (Object.keys(this._queue.workers).length === 0) {
		console.log('Finished!');
		console.log(datastore.map.vertexCount());
		console.log(datastore.map.edgeCount());
	}
};

processSite(datastore.domain);

function processSite(siteUrl) {
	console.log('Processing ' + siteUrl.hostname);

	datastore.queue = new DynamicQueue(processPage);

	datastore.queue.push({ url: siteUrl });
}

function processPage(item, callback) {
	var previousVertex = item.previous,
		pageUrl = item.url;

	if (datastore.map.hasVertex(url.format(pageUrl))) {
		// make sure we capture the edge, even if we don't need to
		if (previousVertex) {
			datastore.map.ensureEdge(previousVertex, url.format(pageUrl));
		}
		console.log('Skipping already processed page: ' + url.format(pageUrl));
		callback();
		return;
	}

	//console.log('Processing Page ' + pageUrl.href);
	console.log(datastore.queue.length());

	request.get(pageUrl.href, function(err, res, body) {
		var $body = $(body);

		var item = {
			localPage: pageUrl.hostname == datastore.domain.hostname,
			url: url.format(pageUrl),
			title: $body.find('title').text()
		};

		// create new vertex
		datastore.map.ensureVertex(item.url, item);

		// register the edge
		if (previousVertex) {
			datastore.map.ensureEdge(previousVertex, url.format(pageUrl));
		}

		// if not local domain, exit!
		if (!item.localPage) {
			//console.log('Skipping links for external page: ' + url.format(pageUrl));
			callback();
			return;
		}

		$body.find('a').each(function(idx, elem) {

			// skip empty elements
			if (!$(elem).attr('href')) {
				return;
			}

			var link = url.parse($(elem).attr('href'));

			// local link from page
			if (!link.hostname) {
				link = url.parse(url.resolve(url.format(pageUrl), url.format(link)));
			}

			// only push links we haven't seen before
			if (!datastore.map.hasVertex(url.format(link))) {
				datastore.queue.push({ previous: item.url, url: link });
			}
		});

		callback();
	});
}

