/*! @license ©2014 Ruben Verborgh - Multimedia Lab / iMinds / Ghent University */
var N3 = require('n3'),
    _ = require('lodash');

/**
 * Utility functions for working with URIs, triples, variables, and patterns.
 * @exports RdfUtil
 * @extends N3.Util
 */
var util = module.exports = N3.Util({});

/* Methods for URIs */

/** Checks whether two URIs are equal after decoding, to make up for encoding differences. **/
util.decodedURIEquals = function (URIa, URIb) {
  if (URIa === URIb) return true;
  try { return decodeURI(URIa) === decodeURI(URIb); }
  catch (error) { return false; }
};

/** Transforms a skolemized URI into a blank node. */
util.deskolemize = function (URI) {
  return URI && URI.replace(genidMatcher, function (URI, id) {
    return '_:' + id.replace(/\W/g, '_');
  });
};
var genidMatcher = /^https?:\/\/[^\/]+\/\.well-known\/genid\/([^]+)$/;


/* Methods for triples */

/** Creates a triple object from the components. */
util.triple = function (subject, predicate, object) {
  return { graph: null, subject: subject, predicate: predicate, object: object };
};

/** Creates a quad object from the components. */
util.quad = function (graph, subject, predicate, object) {
  return { graph: graph, subject: subject, predicate: predicate, object: object };
};

/* Methods for variables and triple patterns */

/** Creates a quick string representation of a triple or triple component. */
util.toQuickString = function (triple) {
  // Empty object means empty string
  if (!triple)
    return '';
  // Convert a triple component by abbreviating it
  if (typeof triple === 'string') {
    if (util.isVariableOrBlank(triple))
      return triple;
    if (util.isLiteral(triple))
      return '"' + util.getLiteralValue(triple) + '"';
    var match = triple.match(/([a-zA-Z\(\)_\.,'0-9]+)[^a-zAZ]*?$/);
    return match ? match[1] : triple;
  }
  // Convert a triple by converting its components
  return util.toQuickString(triple.subject) + ' ' +
         util.toQuickString(triple.predicate) + ' ' +
         util.toQuickString(triple.object) + '.';
};

/** Checks whether the entity represents a variable. */
util.isVariable = function (entity) {
  return (typeof entity !== 'string') || (entity[0] === '?');
};

/** Checks whether the triple pattern has variables. */
util.hasVariables = function (pattern) {
  return !!pattern && (util.isVariable(pattern.subject) ||
                       util.isVariable(pattern.predicate) ||
                       util.isVariable(pattern.object));
};

/** Returns all variables in the triple pattern. */
util.getVariables = function (pattern) {
  var variables = [];
  if (util.isVariable(pattern.subject))   variables.push(pattern.subject);
  if (util.isVariable(pattern.predicate)) variables.push(pattern.predicate);
  if (util.isVariable(pattern.object))    variables.push(pattern.object);
  return variables;
};

/** Checks whether the entity represents a variable or blank node. */
util.isVariableOrBlank = function (entity) {
  return (typeof entity !== 'string') || (entity[0] === '?') ||
                                         (entity[0] === '_' && entity[1] === ':');
};

/** Checks whether the triple pattern has variables or blanks. */
util.hasVariablesOrBlanks = function (pattern) {
  return !!pattern && (util.isVariableOrBlank(pattern.subject) ||
                       util.isVariableOrBlank(pattern.predicate) ||
                       util.isVariableOrBlank(pattern.object));
};

/** Creates a filter for triples that match the given pattern. */
util.tripleFilter = function (triplePattern) {
  var pattern = triplePattern || {},
      subject   = util.isVariableOrBlank(pattern.subject)   ? null : pattern.subject,
      predicate = util.isVariableOrBlank(pattern.predicate) ? null : pattern.predicate,
      object    = util.isVariableOrBlank(pattern.object)    ? null : pattern.object;
  return function (triple) {
    return (subject === null   || subject   === triple.subject) &&
           (predicate === null || predicate === triple.predicate) &&
           (object === null    || object    === triple.object);
  };
};

/** Applies the given bindings to the triple or graph pattern, returning a bound copy thereof. */
util.applyBindings = function (bindings, pattern) {
  // Bind a graph pattern
  if (typeof pattern.map === 'function')
    return pattern.map(function (p) { return util.applyBindings(bindings, p); });
  // Bind a triple pattern
  return {
    graph:     bindings[pattern.graph]     || pattern.graph,
    subject:   bindings[pattern.subject]   || pattern.subject,
    predicate: bindings[pattern.predicate] || pattern.predicate,
    object:    bindings[pattern.object]    || pattern.object,
  };
};

/** Finds the bindings that transform the pattern into the triple. */
util.findBindings = function (triplePattern, boundTriple) {
  return util.extendBindings(null, triplePattern, boundTriple);
};

/** Creates augmented bindings that include bindings to transform the pattern into the triple. */
util.extendBindings = function (bindings, triplePattern, boundTriple) {
  var newBindings = Object.create(null);
  for (var binding in bindings)
    newBindings[binding] = bindings[binding];
  util.addBinding(newBindings, triplePattern.subject,   boundTriple.subject);
  util.addBinding(newBindings, triplePattern.predicate, boundTriple.predicate);
  util.addBinding(newBindings, triplePattern.object,    boundTriple.object);
  return newBindings;
};

/** Extends the bindings with a binding that binds the left component to the right. */
util.addBinding = function (bindings, left, right) {
  // The left side may be variable; the right side may not
  if (util.isVariableOrBlank(right))
    throw new Error('Right-hand side must not be variable.');
  // If the left one is the variable
  if (util.isVariableOrBlank(left)) {
    // Add it to the bindings if it wasn't already bound
    if (!(left in bindings))
      bindings[left] = right;
    // The right-hand side should be consistent with the binding
    else if (right !== bindings[left])
      throw new Error(['Cannot bind', left, 'to', right,
                       'because it was already bound to', bindings[left] + '.'].join(' '));
  }
  // Both are constants, so they should be equal for a successful binding
  else if (left !== right) {
    throw new Error(['Cannot bind', left, 'to', right].join(' '));
  }
  // Return the extended bindings
  return bindings;
};


/* Methods for graph patterns */

/** Finds connected subpatterns within the possibly disconnected graph pattern. */
util.findConnectedPatterns = function (graphPattern) {
  // Zero or single-triple patterns have exactly one cluster
  if (graphPattern.length <= 1)
    return [graphPattern];

  // Initially consider all individual triple patterns as disconnected clusters
  var clusters = graphPattern.map(function (triple) {
    // use empty string dummy value for default graph null
    triple.graph = triple.graph === null ? '' : triple.graph;

    return {
      triples:  [triple],
      variables: _.values(triple).filter(util.isVariableOrBlank),
    };
  }), commonVar;

  // Continue clustering as long as different clusters have common variables
  do {
    // Find a variable that occurs in more than one subpattern
    var allVariables = _.flatten(_.pluck(clusters, 'variables'));
    if (commonVar = _.find(allVariables, hasDuplicate)) {
      // Partition the subpatterns by whether they contain that common variable
      var hasCommon = _.groupBy(clusters,
                                function (c) { return _.contains(c.variables, commonVar); });
      // Replace the subpatterns with a common variable by a subpattern that combines them
      clusters = hasCommon[false] || [];
      clusters.push({
        triples:   _.union.apply(_, _.pluck(hasCommon[true], 'triples')),
        variables: _.union.apply(_, _.pluck(hasCommon[true], 'variables')),
      });
    }
  } while (commonVar);

  // The subpatterns consist of the triples of each cluster
  return _.pluck(clusters, 'triples')
    // convert empty string back to null value for default graph
    .map(function (triples) {
      return triples.map(function (triple) {
        triple.graph = triple.graph === '' ? null : triple.graph;

        return triple;
      });
    });
};

// Array filter that finds values occurring more than once
function hasDuplicate(value, index, array) {
  return index !== array.lastIndexOf(value);
}

/* Common RDF namespaces and URIs */

namespace('rdf', 'http://www.w3.org/1999/02/22-rdf-syntax-ns#', [
  'type', 'subject', 'predicate', 'object',
]);

namespace('void', 'http://rdfs.org/ns/void#', [
  'triples',
]);

namespace('hydra', 'http://www.w3.org/ns/hydra/core#', [
  'search', 'template', 'mapping', 'property', 'variable', 'totalItems',
]);

namespace('foaf', 'http://xmlns.com/foaf/0.1/');

namespace('dbpedia', 'http://dbpedia.org/resource/');
namespace('dbpedia-owl', 'http://dbpedia.org/ontology/');

function namespace(prefix, base, names) {
  var key = prefix.replace(/[^a-z]/g, '').toUpperCase();
  util[key] = base;
  names && names.forEach(function (name) {
    util[key + '_' + name.toUpperCase()] = base + name;
  });
}

Object.freeze(util);
