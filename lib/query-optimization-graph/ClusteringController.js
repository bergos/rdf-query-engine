/**
 * Created by joachimvh on 11/09/2014.
 */

var rdf = require('../util/RdfUtil'),
  _ = require('lodash'),
  TriplePatternIterator = require('../triple-pattern-fragments/TriplePatternIterator'),
  Iterator = require('../iterators/Iterator'),
  MultiTransformIterator = require('../iterators/MultiTransformIterator'),
  Logger = require ('../util/Logger'),
  ClusteringUtil = require('./ClusteringUtil'),
  RDFStoreInterface = require('./RDFStoreInterface'),
  Stream = require('./Stream'),
  Cluster = require('./Cluster'),
  Node = require('./Node');

function ClusteringController (nodes, clusters) {
  this.clusters = clusters;
  this.nodes = nodes;
  this.logger = new Logger("ClusteringController");
}

ClusteringController.create = function (patterns, options, callback) {
  var clusters = {};
  var nodes = [];

  var delayedCallback = _.after(_.size(patterns), function () {
    var controller = new ClusteringController(nodes, clusters);
    callback(controller);
  });

  _.each(patterns, function (pattern) {
    var fragment = options.fragmentsClient.getFragmentByPattern(pattern);
    fragment.getProperty('metadata', function(metadata) {
      fragment.close();
      var node = new Node(pattern, metadata.totalTriples, options);
      nodes.push(node);
      var vars = ClusteringUtil.getVariables(pattern);
      _.each(vars, function (v) {
        clusters[v] = clusters[v] || new Cluster(v);
        clusters[v].nodes.push(node);
      });
      delayedCallback();
    });
  });
};

ClusteringController.prototype.read = function () {
  var minNode = _.min(this.nodes, function (node) { return node.cost(); });

  if (minNode === Infinity)
    return console.error('Finished, totally not a bug!');

  var minCost = minNode.cost();

  var self = this;
  if (minCost > 0)
    _.each(self.nodes, function (node) { node.spend(minCost); });

  minNode.read(function (add, remove) {
    // TODO: add triples to store

    var vars = ClusteringUtil.getVariables(minNode.pattern);
    _.each(vars, function (v) {
      self.clusters[v].removeBindings(_.filter(_.pluck(remove, v)));
      self.clusters[v].addBindings(_.filter(_.pluck(add, v)));
      if (minNode.ended()) {
        var pos = minNode.getVariablePosition(v);
        var bounds = _.uniq(_.pluck(minNode.triples, pos));
        self.clusters[v].addBounds(bounds);
      }
    });

    // TODO: ----------- bounds ------------
    // TODO: need to do an estimation of the % matches between multiple streams, else we will always have to wait for bounds
    // TODO: don't need data from download streams if no stream is waiting on more data (except for ^)
    // TODO: don't start using bindingstreams unless we have matching values from all attached download streams?
    // TODO: disadvantage: can keep waiting, can already filter some of the results, advantage: need data from the other stream anyway

    var delayedCallback = _.after(_.size(self.clusters), function () {
      setImmediate(function () { self.read(); });
    });
    _.each(self.clusters, function (cluster) {
      cluster.update(delayedCallback);
    });
  });
};

ClusteringController.prototype.read2 = function () {
  var minNode = _.min(this.nodes, function (node) { return node.cost(); });

  if (minNode === Infinity)
    return console.error('Finished, totally not a bug!');

  var minCost = minNode.cost();

  var self = this;
  _.each(this.nodes, function (node) {
    // TODO: problem: expensive streams, need to detect bound or not
    node.read2(minCost, function (add, remove) {
      // TODO: count each value?
      var vars = ClusteringUtil.getVariables(node.pattern);
      _.each(vars, function (v) {
        self.clusters[v].removeBindings(_.filter(_.pluck(remove, v)));
        if (node.supplies(v))
          self.clusters[v].addBindings(_.filter(_.pluck(add, v)));
        // TODO: bounds and stuff
      });
    });
  });
};

module.exports = ClusteringController;