'no use strict';
// Remove "use strict"; from transpiled module until
// https://bugs.webkit.org/show_bug.cgi?id=138038 is fixed

import { EmptyObject, lookupDescriptor, symbol } from 'ember-utils';
import isEnabled from './features';
import { protoMethods as listenerMethods } from './meta_listeners';
import { runInDebug } from './debug';

let counters = {
  peekCalls: 0,
  peekParentCalls: 0,
  peekPrototypeWalks: 0,
  setCalls: 0,
  deleteCalls: 0,
  metaCalls: 0,
  metaInstantiated: 0
};

/**
@module ember-metal
*/

/*
 This declares several meta-programmed members on the Meta class. Such
 meta!

 In general, the `readable` variants will give you an object (if it
 already exists) that you can read but should not modify. The
 `writable` variants will give you a mutable object, and they will
 create it if it didn't already exist.

 The following methods will get generated metaprogrammatically, and
 I'm including them here for greppability:

 writableCache, readableCache, writeWatching,
 peekWatching, clearWatching, writeMixins,
 peekMixins, clearMixins, writeBindings,
 peekBindings, clearBindings, writeValues,
 peekValues, clearValues, writeDeps, forEachInDeps
 writableChainWatchers, readableChainWatchers, writableChains,
 readableChains, writableTag, readableTag

*/
let members = {
  cache: ownMap,
  weak: ownMap,
  watching: inheritedMap,
  mixins: inheritedMap,
  bindings: inheritedMap,
  values: inheritedMap,
  deps: inheritedMapOfMaps,
  chainWatchers: ownCustomObject,
  chains: inheritedCustomObject,
  tag: ownCustomObject
};

if (isEnabled('ember-glimmer-detect-backtracking-rerender') ||
    isEnabled('ember-glimmer-allow-backtracking-rerender')) {
  members.lastRendered = ownMap;
  members.lastRenderedFrom = ownMap; // FIXME: not used in production, remove me from prod builds
}

let memberNames = Object.keys(members);
const META_FIELD = '__ember_meta__';

export function Meta(obj, parentMeta) {
  runInDebug(() => counters.metaInstantiated++);

  this._cache = undefined;
  this._weak = undefined;
  this._watching = undefined;
  this._mixins = undefined;
  this._bindings = undefined;
  this._values = undefined;
  this._deps = undefined;
  this._chainWatchers = undefined;
  this._chains = undefined;
  this._tag = undefined;

  // used only internally
  this.source = obj;

  // when meta(obj).proto === obj, the object is intended to be only a
  // prototype and doesn't need to actually be observable itself
  this.proto = undefined;

  // The next meta in our inheritance chain. We (will) track this
  // explicitly instead of using prototypical inheritance because we
  // have detailed knowledge of how each property should really be
  // inherited, and we can optimize it much better than JS runtimes.
  this.parent = parentMeta;

  if (isEnabled('ember-glimmer-detect-backtracking-rerender') ||
      isEnabled('ember-glimmer-allow-backtracking-rerender')) {
    this._lastRendered = undefined;
    this._lastRenderedFrom = undefined; // FIXME: not used in production, remove me from prod builds
  }

  this._initializeListeners();
}

Meta.prototype.isInitialized = function(obj) {
  return this.proto !== obj;
};

for (let name in listenerMethods) {
  Meta.prototype[name] = listenerMethods[name];
}
memberNames.forEach(name => members[name](name, Meta));

// Implements a member that is a lazily created, non-inheritable
// POJO.
function ownMap(name, Meta) {
  let key = memberProperty(name);
  let capitalized = capitalize(name);
  Meta.prototype['writable' + capitalized] = function() {
    return this._getOrCreateOwnMap(key);
  };
  Meta.prototype['readable' + capitalized] = function() { return this[key]; };
}

Meta.prototype._getOrCreateOwnMap = function(key) {
  let ret = this[key];
  if (!ret) {
    ret = this[key] = new EmptyObject();
  }
  return ret;
};

// Implements a member that is a lazily created POJO with inheritable
// values.
function inheritedMap(name, Meta) {
  let key = memberProperty(name);
  let capitalized = capitalize(name);

  Meta.prototype['write' + capitalized] = function(subkey, value) {
    let map = this._getOrCreateOwnMap(key);
    map[subkey] = value;
  };

  Meta.prototype['peek' + capitalized] = function(subkey) {
    return this._findInherited(key, subkey);
  };

  Meta.prototype['forEach' + capitalized] = function(fn) {
    let pointer = this;
    let seen = new EmptyObject();
    while (pointer !== undefined) {
      let map = pointer[key];
      if (map) {
        for (let key in map) {
          if (!seen[key]) {
            seen[key] = true;
            fn(key, map[key]);
          }
        }
      }
      pointer = pointer.parent;
    }
  };

  Meta.prototype['clear' + capitalized] = function() {
    this[key] = undefined;
  };

  Meta.prototype['deleteFrom' + capitalized] = function(subkey) {
    delete this._getOrCreateOwnMap(key)[subkey];
  };

  Meta.prototype['hasIn' + capitalized] = function(subkey) {
    return this._findInherited(key, subkey) !== undefined;
  };
}

Meta.prototype._getInherited = function(key) {
  let pointer = this;
  while (pointer !== undefined) {
    if (pointer[key]) {
      return pointer[key];
    }
    pointer = pointer.parent;
  }
};

Meta.prototype._findInherited = function(key, subkey) {
  let pointer = this;
  while (pointer !== undefined) {
    let map = pointer[key];
    if (map) {
      let value = map[subkey];
      if (value !== undefined) {
        return value;
      }
    }
    pointer = pointer.parent;
  }
};

export const UNDEFINED = symbol('undefined');

// Implements a member that provides a lazily created map of maps,
// with inheritance at both levels.
function inheritedMapOfMaps(name, Meta) {
  let key = memberProperty(name);
  let capitalized = capitalize(name);

  Meta.prototype['write' + capitalized] = function(subkey, itemkey, value) {
    let outerMap = this._getOrCreateOwnMap(key);
    let innerMap = outerMap[subkey];
    if (!innerMap) {
      innerMap = outerMap[subkey] = new EmptyObject();
    }
    innerMap[itemkey] = value;
  };

  Meta.prototype['peek' + capitalized] = function(subkey, itemkey) {
    let pointer = this;
    while (pointer !== undefined) {
      let map = pointer[key];
      if (map) {
        let value = map[subkey];
        if (value) {
          if (value[itemkey] !== undefined) {
            return value[itemkey];
          }
        }
      }
      pointer = pointer.parent;
    }
  };

  Meta.prototype['has' + capitalized] = function(subkey) {
    let pointer = this;
    while (pointer !== undefined) {
      if (pointer[key] && pointer[key][subkey]) {
        return true;
      }
      pointer = pointer.parent;
    }
    return false;
  };

  Meta.prototype['forEachIn' + capitalized] = function(subkey, fn) {
    return this._forEachIn(key, subkey, fn);
  };
}

Meta.prototype._forEachIn = function(key, subkey, fn) {
  let pointer = this;
  let seen = new EmptyObject();
  let calls = [];
  while (pointer !== undefined) {
    let map = pointer[key];
    if (map) {
      let innerMap = map[subkey];
      if (innerMap) {
        for (let innerKey in innerMap) {
          if (!seen[innerKey]) {
            seen[innerKey] = true;
            calls.push([innerKey, innerMap[innerKey]]);
          }
        }
      }
    }
    pointer = pointer.parent;
  }
  for (let i = 0; i < calls.length; i++) {
    let [innerKey, value] = calls[i];
    fn(innerKey, value);
  }
};

// Implements a member that provides a non-heritable, lazily-created
// object using the method you provide.
function ownCustomObject(name, Meta) {
  let key = memberProperty(name);
  let capitalized = capitalize(name);
  Meta.prototype['writable' + capitalized] = function(create) {
    let ret = this[key];
    if (!ret) {
      ret = this[key] = create(this.source);
    }
    return ret;
  };
  Meta.prototype['readable' + capitalized] = function() {
    return this[key];
  };
}

// Implements a member that provides an inheritable, lazily-created
// object using the method you provide. We will derived children from
// their parents by calling your object's `copy()` method.
function inheritedCustomObject(name, Meta) {
  let key = memberProperty(name);
  let capitalized = capitalize(name);
  Meta.prototype['writable' + capitalized] = function(create) {
    let ret = this[key];
    if (!ret) {
      if (this.parent) {
        ret = this[key] = this.parent['writable' + capitalized](create).copy(this.source);
      } else {
        ret = this[key] = create(this.source);
      }
    }
    return ret;
  };
  Meta.prototype['readable' + capitalized] = function() {
    return this._getInherited(key);
  };
}


function memberProperty(name) {
  return '_' + name;
}

// there's a more general-purpose capitalize in ember-runtime, but we
// don't want to make ember-metal depend on ember-runtime.
function capitalize(name) {
  return name.replace(/^\w/, m => m.toUpperCase());
}

export var META_DESC = {
  writable: true,
  configurable: true,
  enumerable: false,
  value: null
};

const EMBER_META_PROPERTY = {
  name: META_FIELD,
  descriptor: META_DESC
};

if (isEnabled('mandatory-setter')) {
  Meta.prototype.readInheritedValue = function(key, subkey) {
    let internalKey = `_${key}`;

    let pointer = this;

    while (pointer !== undefined) {
      let map = pointer[internalKey];
      if (map) {
        let value = map[subkey];
        if (value !== undefined || subkey in map) {
          return map[subkey];
        }
      }
      pointer = pointer.parent;
    }

    return UNDEFINED;
  };

  Meta.prototype.writeValue = function(obj, key, value) {
    let descriptor = lookupDescriptor(obj, key);
    let isMandatorySetter = descriptor && descriptor.set && descriptor.set.isMandatorySetter;

    if (isMandatorySetter) {
      this.writeValues(key, value);
    } else {
      obj[key] = value;
    }
  };
}

const HAS_NATIVE_WEAKMAP = (function() {
  // detect if `WeakMap` is even present
  let hasWeakMap = typeof WeakMap === 'function';
  if (!hasWeakMap) { return false; }

  let instance = new WeakMap();
  // use `Object`'s `.toString` directly to prevent us from detecting
  // polyfills as native weakmaps
  return Object.prototype.toString.call(instance) === '[object WeakMap]';
})();

let setMeta, peekMeta, deleteMeta;

// choose the one appropriate for given platform
if (HAS_NATIVE_WEAKMAP) {
  let getPrototypeOf = Object.getPrototypeOf;
  let metaStore = new WeakMap();

  setMeta = function WeakMap_setMeta(obj, meta) {
    runInDebug(() => counters.setCalls++);
    metaStore.set(obj, meta);
  };

  peekMeta = function WeakMap_peekMeta(obj) {
    runInDebug(() => counters.peekCalls++);

    return metaStore.get(obj);
  };

  peekMeta = function WeakMap_peekParentMeta(obj) {
    let pointer = obj;
    let meta;
    while (pointer) {
      meta = metaStore.get(pointer);
      // jshint loopfunc:true
      runInDebug(() => counters.peekCalls++);
      // stop if we find a `null` value, since
      // that means the meta was deleted
      // any other truthy value is a "real" meta
      if (meta === null || meta) {
        return meta;
      }

      pointer = getPrototypeOf(pointer);
      runInDebug(() => counters.peakPrototypeWalks++);
    }
  };

  deleteMeta = function WeakMap_deleteMeta(obj) {
    runInDebug(() => counters.deleteCalls++);

    // set value to `null` so that we can detect
    // a deleted meta in peekMeta later
    metaStore.set(obj, null);
  };
} else {
  setMeta = function Fallback_setMeta(obj, meta) {
    // if `null` already, just set it to the new value
    // otherwise define property first
    if (obj[META_FIELD] !== null) {
      if (obj.__defineNonEnumerable) {
        obj.__defineNonEnumerable(EMBER_META_PROPERTY);
      } else {
        Object.defineProperty(obj, META_FIELD, META_DESC);
      }
    }

    obj[META_FIELD] = meta;
  };

  peekMeta = function Fallback_peekMeta(obj) {
    return obj[META_FIELD];
  };

  deleteMeta = function Fallback_deleteMeta(obj) {
    if (typeof obj[META_FIELD] !== 'object') {
      return;
    }
    obj[META_FIELD] = null;
  };
}

/**
  Retrieves the meta hash for an object. If `writable` is true ensures the
  hash is writable for this object as well.

  The meta object contains information about computed property descriptors as
  well as any watched properties and other information. You generally will
  not access this information directly but instead work with higher level
  methods that manipulate this hash indirectly.

  @method meta
  @for Ember
  @private

  @param {Object} obj The object to retrieve meta for
  @param {Boolean} [writable=true] Pass `false` if you do not intend to modify
    the meta hash, allowing the method to avoid making an unnecessary copy.
  @return {Object} the meta hash for an object
*/
export function meta(obj) {
  runInDebug(() => counters.metaCalls++);

  let maybeMeta = peekMeta(obj);
  let parent;

  // remove this code, in-favor of explicit parent
  if (maybeMeta) {
    if (maybeMeta.source === obj) {
      return maybeMeta;
    }
    parent = maybeMeta;
  }

  let newMeta = new Meta(obj, parent);
  setMeta(obj, newMeta);
  return newMeta;
}

export {
  peekMeta,
  setMeta,
  deleteMeta,
  counters
};
