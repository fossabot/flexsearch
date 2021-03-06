;/**!
 * @preserve FlexSearch v0.2.49
 * Copyright 2018 Thomas Wilkerling
 * Released under the Apache 2.0 Licence
 * https://github.com/nextapps-de/flexsearch
 */

/** @define {boolean} */
var SUPPORT_WORKER = true;

/** @define {boolean} */
var SUPPORT_BUILTINS = true;

/** @define {boolean} */
var SUPPORT_DEBUG = true;

/** @define {boolean} */
var SUPPORT_CACHE = true;

/** @define {boolean} */
var SUPPORT_ASYNC = true;

(function(){

    provide('FlexSearch', (function factory(register_worker){

        "use strict";

        /**
         * @struct
         * @private
         * @const
         * @final
         */

        var defaults = {

            encode: 'icase',
            mode: 'ngram',
            suggest: false,
            cache: false,
            async: false,
            worker: false,

            // minimum scoring (0 - 9)
            threshold: 0,

            // contextual depth
            depth: 0
        };

        /**
         * @private
         * @enum {Object}
         * @const
         * @final
         */

        var profiles = {

            "memory": {
                encode: "extra",
                mode: "strict",
                threshold: 7
            },

            "speed": {
                encode: "icase",
                mode: "strict",
                threshold: 7,
                depth: 2
            },

            "match": {
                encode: "extra",
                mode: "full"
            },

            "score": {
                encode: "extra",
                mode: "strict",
                threshold: 5,
                depth: 4
            },

            "balance": {
                encode: "balance",
                mode: "ngram",
                threshold: 6,
                depth: 3
            },

            "fastest": {
                encode: "icase",
                mode: "strict",
                threshold: 9,
                depth: 1
            }
        };

        /**
         * @type {Array}
         * @private
         */

        var global_matcher = [];

        /**
         * @type {number}
         * @private
         */

        var id_counter = 0;

        /**
         * @enum {number}
         */

        var enum_task = {

            add: 0,
            update: 1,
            remove: 2
        };

        /**  @const  {RegExp} */
        var regex_split = regex("[ -\/]");

        var filter = {};

        var stemmer = {};

        /**
         * @param {string|Object<string, number|string|boolean|Object|function(string):string>=} options
         * @constructor
         * @private
         */

        function FlexSearch(options){

            if(typeof options === 'string'){

                options = profiles[options];
            }

            options || (options = defaults);

            // generate UID

            /** @export */
            this.id = options['id'] || id_counter++;

            // initialize index

            this.init(options);

            // define functional properties

            registerProperty(this, 'index', /** @this {FlexSearch} */ function(){

                return this._ids;
            });

            registerProperty(this, 'length', /** @this {FlexSearch} */ function(){

                return Object.keys(this._ids).length;
            });
        }

        /**
         * @param {Object<string, number|string|boolean|Object|function(string):string>=} options
         * @export
         */

        FlexSearch.new = function(options){

            return new this(options);
        };

        /**
         * @param {Object<string, number|string|boolean|Object|function(string):string>=} options
         * @export
         */

        FlexSearch.create = function(options){

            return FlexSearch.new(options);
        };

        /**
         * @param {Object<string, string>} matcher
         * @export
         */

        FlexSearch.registerMatcher = function(matcher){

            for(var key in matcher){

                if(matcher.hasOwnProperty(key)){

                    global_matcher[global_matcher.length] = regex(key);
                    global_matcher[global_matcher.length] = matcher[key];
                }
            }

            return this;
        };

        /**
         * @param {string} name
         * @param {function(string):string} encoder
         * @export
         */

        FlexSearch.registerEncoder = function(name, encoder){

            global_encoder[name] = encoder;

            return this;
        };

        /**
         * @param {string} lang
         * @param {Object} language_pack
         * @export
         */

        FlexSearch.registerLanguage = function(lang, language_pack){

            /**
             * @type {Array<string>}
             */

            filter[lang] = language_pack['filter'];

            /**
             * @type {Object<string, string>}
             */

            stemmer[lang] = language_pack['stemmer'];

            return this;
        };

        /**
         * @param {!string} name
         * @param {?string} value
         * @returns {?string}
         * @export
         */

        FlexSearch.encode = function(name, value){

            return global_encoder[name].call(global_encoder, value);
        };

        /**
         * @param {Object<string, number|string|boolean|Object|function(string):string>=} options
         * @export
         */

        FlexSearch.prototype.init = function(options){

            /** @type {Array} */
            this._matcher = [];

            //if(options){

            options || (options = defaults);

                var custom = options['profile'];
                var profile = custom ? profiles[custom] : {};

                // initialize worker

                if(SUPPORT_WORKER && (custom = options['worker'])){

                    if(typeof Worker === 'undefined'){

                        options['worker'] = false;

                        if(SUPPORT_ASYNC){

                            options['async'] = true;
                        }

                        this._worker = null;
                    }
                    else{

                        var self = this;
                        var threads = parseInt(custom, 10) || 4;

                        self._current_task = -1;
                        self._task_completed = 0;
                        self._task_result = [];
                        self._current_callback = null;
                        self._worker = new Array(threads);

                        for(var i = 0; i < threads; i++){

                            self._worker[i] = add_worker(self.id, i, options || defaults, function(id, query, result, limit){

                                if(self._task_completed === self.worker){

                                    return;
                                }

                                self._task_result = self._task_result.concat(result);
                                self._task_completed++;

                                if(limit && (self._task_result.length >= limit)){

                                    self._task_completed = self.worker;
                                }

                                if(self._current_callback && (self._task_completed === self.worker)){

                                    // if(typeof self._last_empty_query !== 'undefined'){
                                    //
                                    //     if(self._task_result.length){
                                    //
                                    //         self._last_empty_query = "";
                                    //     }
                                    //     else{
                                    //
                                    //         self._last_empty_query || (self._last_empty_query = query);
                                    //     }
                                    // }

                                    // store result to cache

                                    if(self.cache){

                                        self._cache.set(query, self._task_result);
                                    }

                                    self._current_callback(self._task_result);
                                    self._task_result = [];
                                }
                            });
                        }
                    }
                }

                // apply custom options

                this.mode = (

                    options['mode'] ||
                    profile.mode ||
                    this.mode ||
                    defaults.mode
                );

                if(SUPPORT_ASYNC) this.async = (

                    options['async'] ||
                    this.async ||
                    defaults.async
                );

                if(SUPPORT_WORKER) this.worker = (

                    options['worker'] ||
                    this.worker ||
                    defaults.worker
                );

                this.threshold = (

                    options['threshold'] ||
                    profile.threshold ||
                    this.threshold ||
                    defaults.threshold
                );

                this.depth = (

                    options['depth'] ||
                    profile.depth ||
                    this.depth ||
                    defaults.depth
                );

                this.suggest = (

                    options['suggest'] ||
                    this.suggest ||
                    defaults.suggest
                );

                custom = options['encode'] || profile.encode;

                this.encoder = (

                    (custom && global_encoder[custom]) ||
                    (typeof custom === 'function' ? custom : this.encoder || false)
                );

                if(SUPPORT_DEBUG){

                    this.debug = (

                        options['debug'] ||
                        this.debug
                    );
                }

                if(custom = options['matcher']) {

                    this.addMatcher(

                        /** @type {Object<string, string>} */
                        (custom)
                    );
                }

                if((custom = options['filter'])) {

                    this.filter = initFilter(filter[custom] || custom, this.encoder);
                }

                if((custom = options['stemmer'])) {

                    this.stemmer = initStemmer(stemmer[custom] || custom, this.encoder);
                }
            //}

            // initialize primary index

            this._map = [

                {/* 0 */}, {/* 1 */}, {/* 2 */}, {/* 3 */}, {/* 4 */},
                {/* 5 */}, {/* 6 */}, {/* 7 */}, {/* 8 */}, {/* 9 */}
            ];

            this._ctx = {};
            this._ids = {};
            this._stack = {};
            this._stack_keys = [];

            /**
             * @type {number|null}
             */

            this._timer = null;
            this._status = true;

            // if(this.mode === 'forward' || this.mode === 'reverse' || this.mode === 'both'){
            //
            //     this._last_empty_query = "";
            // }

            if(SUPPORT_CACHE) {

                this.cache = custom = (

                    options['cache'] ||
                    this.cache ||
                    defaults.cache
                );

                this._cache = custom ?

                    (new cache(custom))
                :
                    false;
            }

            return this;
        };

        /**
         * @param {?string} value
         * @returns {?string}
         * @export
         */

        FlexSearch.prototype.encode = function(value){

            if(value && global_matcher.length){

                value = replace(value, global_matcher);
            }

            if(value && this._matcher.length){

                value = replace(value, this._matcher);
            }

            if(value && this.encoder){

                value = this.encoder.call(global_encoder, value);
            }

            // TODO completely filter out words actually can break the context chain
            /*
            if(value && this.filter){

                var words = value.split(' ');
                //var final = "";

                for(var i = 0; i < words.length; i++){

                    var word = words[i];
                    var filter = this.filter[word];

                    if(filter){

                        //var length = word.length - 1;

                        words[i] = filter;
                        //words[i] = word[0] + (length ? word[1] : '');
                        //words[i] = '~' + word[0];
                        //words.splice(i, 1);
                        //i--;
                        //final += (final ? ' ' : '') + word;
                    }
                }

                value = words.join(' '); // final;
            }
            */

            if(value && this.stemmer){

                value = replace(value, this.stemmer);
            }

            return value;
        };

        /**
         * @param {Object<string, string>} custom
         * @export
         */

        FlexSearch.prototype.addMatcher = function(custom){

            var matcher = this._matcher;

            for(var key in custom){

                if(custom.hasOwnProperty(key)){

                    matcher[matcher.length] = regex(key);
                    matcher[matcher.length] = custom[key];
                }
            }

            return this;
        };

        /**
         * @param {?number|string} id
         * @param {?string} content
         * @param {boolean=} _skip_update
         * @this {FlexSearch}
         * @export
         */

        FlexSearch.prototype.add = function(id, content, _skip_update){

            if((typeof content === 'string') && content && (id || (id === 0))){

                // check if index ID already exist

                if(this._ids[id] && !_skip_update){

                    this.update(id, content);
                }
                else{

                    if(SUPPORT_WORKER && this.worker){

                        if(++this._current_task >= this._worker.length) this._current_task = 0;

                        this._worker[this._current_task].postMessage(this._current_task, {

                            'add': true,
                            'id': id,
                            'content': content
                        });

                        this._ids[id] = "" + this._current_task;

                        return this;
                    }

                    if(SUPPORT_ASYNC && this.async){

                        this._stack[id] || (

                            this._stack_keys[this._stack_keys.length] = id
                        );

                        this._stack[id] = [

                            enum_task.add,
                            id,
                            content
                        ];

                        register_task(this);

                        return this;
                    }

                    content = this.encode(content);

                    if(!content.length){

                        return this;
                    }

                    var tokenizer = this.mode;

                    var words = (

                        typeof tokenizer === 'function' ?

                            tokenizer(content)
                        :(
                            tokenizer === 'ngram' ?

                                /** @type {!Array<string>} */
                                (ngram(content))
                            :
                                /** @type {string} */
                                (content).split(regex_split)
                        )
                    );

                    var dupes = {

                        '_ctx': {}
                    };

                    var threshold = this.threshold;
                    var depth = this.depth;
                    var map = this._map;
                    var word_length = words.length;

                    // tokenize

                    for(var i = 0; i < word_length; i++){

                        /** @type {string} */
                        var value = words[i];

                        if(value){

                            var length = value.length;
                            var context_score = (word_length - i) / word_length;

                            switch(tokenizer){

                                case 'reverse':
                                case 'both':

                                    var tmp = "";

                                    for(var a = length - 1; a >= 1; a--){

                                        tmp = value[a] + tmp;

                                        addIndex(

                                            map,
                                            dupes,
                                            tmp,
                                            id,
                                            (length - a) / length,
                                            context_score,
                                            threshold
                                        );
                                    }

                                // Note: no break here, fallthrough to next case

                                case 'forward':

                                    var tmp = "";

                                    for(var a = 0; a < length; a++){

                                        tmp += value[a];

                                        addIndex(

                                            map,
                                            dupes,
                                            tmp,
                                            id,
                                            1,
                                            context_score,
                                            threshold
                                        );
                                    }

                                    break;

                                case 'full':

                                    var tmp = "";

                                    for(var x = 0; x < length; x++){

                                        var partial_score = (length - x) / length;

                                        for(var y = length; y > x; y--){

                                            tmp = value.substring(x, y);

                                            addIndex(

                                                map,
                                                dupes,
                                                tmp,
                                                id,
                                                partial_score,
                                                context_score,
                                                threshold
                                            );
                                        }
                                    }

                                    break;

                                case 'strict':
                                case 'ngram':
                                default:

                                    var score = addIndex(

                                        map,
                                        dupes,
                                        value,
                                        id,
                                        // Note: ngrams has partial scoring (sequence->word) and contextual scoring (word->context)
                                        // TODO compute and pass distance of ngram sequences as the initial score for each word
                                        1,
                                        context_score,
                                        threshold
                                    );

                                    if(depth && (word_length > 1) && (score >= threshold)){

                                        var ctx_dupes = dupes['_ctx'][value] || (dupes['_ctx'][value] = {});
                                        var ctx_tmp = this._ctx[value] || (this._ctx[value] = [

                                            {/* 0 */}, {/* 1 */}, {/* 2 */}, {/* 3 */}, {/* 4 */},
                                            {/* 5 */}, {/* 6 */}, {/* 7 */}, {/* 8 */}, {/* 9 */}
                                        ]);

                                        var x = i - depth;
                                        var y = i + depth + 1;

                                        if(x < 0) x = 0;
                                        if(y > word_length) y = word_length;

                                        for(; x < y; x++){

                                            if(x !== i) addIndex(

                                                ctx_tmp,
                                                ctx_dupes,
                                                words[x],
                                                id,
                                                0,
                                                10 - (x < i ? i - x : x - i),
                                                threshold
                                            );
                                        }
                                    }

                                    break;
                            }
                        }
                    }

                    // update status

                    this._ids[id] = "1";
                    this._status = false;
                }
            }

            return this;
        };

        /**
         * @param id
         * @param content
         * @export
         */

        FlexSearch.prototype.update = function(id, content){

            if(this._ids[id] && content && (typeof content === 'string')){

                this.remove(id);
                this.add(id, content, /* skip_update: */ true);
            }

            return this;
        };

        /**
         * @param id
         * @export
         */

        FlexSearch.prototype.remove = function(id){

            if(this._ids[id]){

                if(SUPPORT_WORKER && this.worker){

                    var int = parseInt(this._ids[id], 10);

                    this._worker[int].postMessage(int, {

                        'remove': true,
                        'id': id
                    });

                    delete this._ids[id];

                    return this;
                }

                if(SUPPORT_ASYNC && this.async){

                    this._stack[id] || (

                        this._stack_keys[this._stack_keys.length] = id
                    );

                    this._stack[id] = [

                        enum_task.remove,
                        id
                    ];

                    register_task(this);

                    return this;
                }

                for(var z = 0; z < 10; z++){

                    removeIndex(this._map[z], id);
                }

                if(this.depth){

                    removeIndex(this._ctx, id);
                }

                delete this._ids[id];

                this._status = false;
            }

            return this;
        };

        /**
         * @param {!string} query
         * @param {number|Function=} limit
         * @param {Function=} callback
         * @returns {Array}
         * @export
         */

        FlexSearch.prototype.search = function(query, limit, callback){

            var threshold;
            var result = [];

            if(query && (typeof query === 'object')){

                // re-assign properties

                callback = query['callback'] || /** @type {?Function} */ (limit);
                limit = query['limit'];
                threshold = query['threshold'];
                query = query['query'];
            }

            threshold = (threshold || this.threshold || 0) | 0;

            if(typeof limit === 'function'){

                callback = limit;
                limit = 1000;
            }
            else{

                limit || (limit = 1000);
            }

            if(SUPPORT_WORKER && this.worker){

                this._current_callback = callback;
                this._task_completed = 0;
                this._task_result = [];

                for(var i = 0; i < this.worker; i++){

                    this._worker[i].postMessage(i, {

                        'search': true,
                        'limit': limit,
                        'threshold': threshold,
                        'content': query
                    });
                }

                return null;
            }

            if(callback){

                /** @type {FlexSearch} */
                var self = this;

                queue(function(){

                    callback(self.search(query, limit));
                    self = null;

                }, 1, 'search-' + this.id);

                return null;
            }

            if(!query || (typeof query !== 'string')){

                return result;
            }

            /** @type {!string|Array<string>} */
            var _query = query;

            // invalidate cache

            if(!this._status){

                if(SUPPORT_CACHE && this.cache){

                    // if(typeof this._last_empty_query !== 'undefined'){
                    //
                    //     this._last_empty_query = "";
                    // }

                    this._cache.reset();
                }

                this._status = true;
            }

            // validate cache

            else if(SUPPORT_CACHE && this.cache){

                var cache = this._cache.get(query);

                if(cache){

                    return cache;
                }
            }

            // validate last query

            // else if((typeof this._last_empty_query !== 'undefined') && this._last_empty_query && (query.indexOf(this._last_empty_query) === 0)){
            //
            //     return result;
            // }

            // encode string

            _query = this.encode(/** @type {string} */ (_query));

            if(!_query.length){

                return result;
            }

            // convert words into single components

            var tokenizer = this.mode;

            var words = (

                typeof tokenizer === 'function' ?

                    tokenizer(_query)
                :(
                    tokenizer === 'ngram' ?

                        /** @type {!Array<string>} */
                        (ngram(_query))
                    :
                        /** @type {string} */
                        (_query).split(regex_split)
                )
            );

            var length = words.length;
            var found = true;
            var check = [];
            var check_words = {};

            if(length > 1){

                if(this.depth){

                    var use_contextual = true;
                    var ctx_root = words[0];

                    check_words[ctx_root] = "1";
                }
                else{

                    // Note: sort words by length only in non-contextual mode

                    words.sort(sortByLengthDown);
                }
            }

            var ctx_map;

            if(!use_contextual || (ctx_map = this._ctx)[ctx_root]){

                for(var a = use_contextual ? 1 : 0; a < length; a++){

                    var value = words[a];

                    if(value && !check_words[value]){

                        var map;
                        var map_found = false;
                        var map_check = [];
                        var count = 0;

                        for(var z = 9; z >= threshold; z--){

                            map = (

                                use_contextual ?

                                    ctx_map[ctx_root]
                                :
                                    this._map

                            )[z][value];

                            if(map){

                                map_check[count++] = map;
                                map_found = true;
                            }
                        }

                        if(!map_found){

                            if(!this.suggest){

                                found = false;
                                break;
                            }
                        }
                        else {

                            // Not handled by intersection:

                            check[check.length] = (

                                count > 1 ?

                                    check.concat.apply([], map_check)
                                :
                                    map_check[0]
                            );

                            // Handled by intersection:

                            // check[check.length] = map_check;
                        }

                        check_words[value] = "1";
                    }

                    ctx_root = value;
                }
            }
            else{

                found = false;
            }

            if(found){

                // Not handled by intersection:

                result = intersect(check, limit, this.suggest);

                // Handled by intersection:

                //result = intersect_3d(check, limit, this.suggest);
            }

            // if(typeof this._last_empty_query !== 'undefined'){
            //
            //     if(result.length){
            //
            //         this._last_empty_query = "";
            //     }
            //     else{
            //
            //         this._last_empty_query || (this._last_empty_query = query);
            //     }
            // }

            // store result to cache

            if(SUPPORT_CACHE && this.cache){

                this._cache.set(query, result);
            }

            return result;
        };

        if(SUPPORT_DEBUG){

            /**
             * @export
             */

            FlexSearch.prototype.info = function(){

                if(SUPPORT_WORKER && this.worker){

                    for(var i = 0; i < this.worker; i++) this._worker[i].postMessage(i, {

                        'info': true,
                        'id': this.id
                    });

                    return;
                }

                var keys;
                var length;

                var bytes = 0,
                    words = 0,
                    chars = 0;

                for(var z = 0; z < 10; z++){

                    keys = Object.keys(this._map[z]);

                    for(var i = 0; i < keys.length; i++){

                        length = this._map[z][keys[i]].length;

                        // Note: 1 char values allocates 1 byte "Map (OneByteInternalizedString)"
                        bytes += length * 1 + keys[i].length * 2 + 4;
                        words += length;
                        chars += keys[i].length * 2;
                    }
                }

                keys = Object.keys(this._ids);

                var items = keys.length;

                for(var i = 0; i < items; i++){

                    bytes += keys[i].length * 2 + 2;
                }

                return {

                    'id': this.id,
                    'memory': bytes,
                    'items': items,
                    'sequences': words,
                    'chars': chars,
                    'status': this._status,
                    'cache': this._stack_keys.length,
                    'matcher': global_matcher.length,
                    'worker': this.worker
                };
            };
        }

        /**
         * @export
         */

        FlexSearch.prototype.reset = function(){

            // destroy index

            this.destroy();

            // initialize index

            return this.init();
        };

        /**
         * @export
         */

        FlexSearch.prototype.destroy = function(){

            // cleanup cache

            if(SUPPORT_CACHE && this.cache){

                this._cache.reset();
                this._cache = null;
            }

            // release references

            this.filter =
            this.stemmer =
            this._scores =
            this._map =
            this._ctx =
            this._ids =
            this._stack =
            this._stack_keys = null;

            return this;
        };

        /** @const */

        var global_encoder_balance = (function(){

            var regex_whitespace = regex('\\s\\s+'),
                regex_strip = regex('[^a-z0-9 ]'),
                regex_space = regex('[-\/]'),
                regex_vowel = regex('[aeiouy]');

            /** @const {Array} */
            var regex_pairs = [

                regex_space, ' ',
                regex_strip, '',
                regex_whitespace, ' '
                //regex_vowel, ''
            ];

            return function(value){

                return collapseRepeatingChars(replace(value.toLowerCase(), regex_pairs));
            }
        })();

        /** @const */

        var global_encoder_icase = function(value){

            return value.toLowerCase();
        };

        /**
         * Phonetic Encoders
         * @dict {Function}
         * @private
         * @const
         * @final
         */

        var global_encoder = SUPPORT_BUILTINS ? {

            // case insensitive search

            'icase': global_encoder_icase,

            // literal normalization

            'simple': (function(){

                var regex_whitespace = regex('\\s\\s+'),
                    regex_strip = regex('[^a-z0-9 ]'),
                    regex_space = regex('[-\/]'),
                    regex_a = regex('[àáâãäå]'),
                    regex_e = regex('[èéêë]'),
                    regex_i = regex('[ìíîï]'),
                    regex_o = regex('[òóôõöő]'),
                    regex_u = regex('[ùúûüű]'),
                    regex_y = regex('[ýŷÿ]'),
                    regex_n = regex('ñ'),
                    regex_c = regex('ç'),
                    regex_s = regex('ß'),
                    regex_and = regex(' & ');

                /** @const {Array} */
                var regex_pairs = [

                    regex_a, 'a',
                    regex_e, 'e',
                    regex_i, 'i',
                    regex_o, 'o',
                    regex_u, 'u',
                    regex_y, 'y',
                    regex_n, 'n',
                    regex_c, 'c',
                    regex_s, 's',
                    regex_and, ' and ',
                    regex_space, ' ',
                    regex_strip, '',
                    regex_whitespace, ' '
                ];

                return function(str){

                    str = replace(str.toLowerCase(), regex_pairs);

                    return (

                        str !== ' ' ? str : ''
                    );
                };
            }()),

            // literal transformation

            'advanced': (function(){

                var regex_space = regex(' '),
                    regex_ae = regex('ae'),
                    regex_ai = regex('ai'),
                    regex_ay = regex('ay'),
                    regex_ey = regex('ey'),
                    regex_oe = regex('oe'),
                    regex_ue = regex('ue'),
                    regex_ie = regex('ie'),
                    regex_sz = regex('sz'),
                    regex_zs = regex('zs'),
                    regex_ck = regex('ck'),
                    regex_cc = regex('cc'),
                    regex_sh = regex('sh'),
                    //regex_th = regex('th'),
                    regex_dt = regex('dt'),
                    regex_ph = regex('ph'),
                    regex_pf = regex('pf'),
                    regex_ou = regex('ou'),
                    regex_uo = regex('uo');

                /** @const {Array} */
                var regex_pairs = [

                    regex_ae, 'a',
                    regex_ai, 'ei',
                    regex_ay, 'ei',
                    regex_ey, 'ei',
                    regex_oe, 'o',
                    regex_ue, 'u',
                    regex_ie, 'i',
                    regex_sz, 's',
                    regex_zs, 's',
                    regex_sh, 's',
                    regex_ck, 'k',
                    regex_cc, 'k',
                    //regex_th, 't',
                    regex_dt, 't',
                    regex_ph, 'f',
                    regex_pf, 'f',
                    regex_ou, 'o',
                    regex_uo, 'u'
                ];

                return /** @this {Object} */ function(string, _skip_post_processing){

                    if(!string){

                        return string;
                    }

                    // perform simple encoding
                    string = this['simple'](string);

                    // normalize special pairs
                    if(string.length > 2){

                        string = replace(string, regex_pairs)
                    }

                    if(!_skip_post_processing){

                        // remove white spaces
                        //string = string.replace(regex_space, '');

                        // delete all repeating chars
                        if(string.length > 1){

                            string = collapseRepeatingChars(string);
                        }
                    }

                    return string;
                };

            })(),

            // phonetic transformation

            'extra': (function(){

                var soundex_b = regex('p'),
                    //soundex_c = regex('[sz]'),
                    soundex_s = regex('z'),
                    soundex_k = regex('[cgq]'),
                    //soundex_i = regex('[jy]'),
                    soundex_m = regex('n'),
                    soundex_t = regex('d'),
                    soundex_f = regex('[vw]');

                /** @const {RegExp} */
                var regex_vowel = regex('[aeiouy]');

                /** @const {Array} */
                var regex_pairs = [

                    soundex_b, 'b',
                    soundex_s, 's',
                    soundex_k, 'k',
                    //soundex_i, 'i',
                    soundex_m, 'm',
                    soundex_t, 't',
                    soundex_f, 'f',
                    regex_vowel, ''
                ];

                return /** @this {Object} */ function(str){

                    if(!str){

                        return str;
                    }

                    // perform advanced encoding
                    str = this['advanced'](str, /* skip post processing? */ true);

                    if(str.length > 1){

                        str = str.split(" ");

                        for(var i = 0; i < str.length; i++){

                            var current = str[i];

                            if(current.length > 1){

                                // remove all vowels after 2nd char
                                str[i] = current[0] + replace(current.substring(1), regex_pairs);
                            }
                        }

                        str = str.join(" ");
                        str = collapseRepeatingChars(str);
                    }

                    return str;
                };
            })(),

            'balance': global_encoder_balance

        } : {

            'icase': global_encoder_icase,
            'balance': global_encoder_balance
        };

        // Xone Async Handler Fallback

        var queue = SUPPORT_ASYNC ? (function(){

            var stack = {};

            return function(fn, delay, id){

                var timer = stack[id];

                if(timer){

                    clearTimeout(timer);
                }

                return (

                    stack[id] = setTimeout(fn, delay)
                );
            };

        })() : null;

        // Flexi-Cache

        var cache = SUPPORT_CACHE ? (function(){

            /** @this {Cache} */
            function Cache(limit){

                this.reset();

                this.limit = (limit !== true) && limit;
            }

            /** @this {Cache} */
            Cache.prototype.reset = function(){

                this.cache = {};
                this.count = {};
                this.index = {};
                this.ids = [];
            };

            /** @this {Cache} */
            Cache.prototype.set = function(id, value){

                if(this.limit && (typeof this.cache[id] === 'undefined')){

                    var length = this.ids.length;

                    if(length === this.limit){

                        length--;

                        var last_id = this.ids[length];

                        delete this.cache[last_id];
                        delete this.count[last_id];
                        delete this.index[last_id];
                    }

                    this.index[id] = length;
                    this.ids[length] = id;
                    this.count[id] = -1;
                    this.cache[id] = value;

                    // shift up counter +1

                    this.get(id);
                }
                else{

                    this.cache[id] = value;
                }
            };

            /**
             * Note: It is better to have the complexity when fetching the cache:
             * @this {Cache}
             */

            Cache.prototype.get = function(id){

                var cache = this.cache[id];

                if(this.limit && cache){

                    var count = ++this.count[id];
                    var index = this.index;
                    var current_index = index[id];

                    if(current_index > 0){

                        var ids = this.ids;
                        var old_index = current_index;

                        // forward pointer
                        while(this.count[ids[--current_index]] <= count){

                            if(current_index === -1){

                                break;
                            }
                        }

                        // move pointer back
                        current_index++;

                        if(current_index !== old_index){

                            // copy values from predecessors
                            for(var i = old_index; i > current_index; i--) {

                                var key = ids[i - 1];

                                ids[i] = key;
                                index[key] = i;
                            }

                            // push new value on top
                            ids[current_index] = id;
                            index[id] = current_index;
                        }
                    }
                }

                return cache;
            };

            return Cache;

        })() : null;

        return FlexSearch;

        // ---------------------------------------------------------
        // Helpers

        function registerProperty(obj, key, fn){

            // define functional properties

            Object.defineProperty(obj, key, {

                get: fn
            });
        }

        /**
         * @param {!string} str
         * @returns {RegExp}
         */

        function regex(str){

            return new RegExp(str, 'g');
        }

        /**
         * @param {!string} str
         * @param {RegExp|Array} regex
         * @param {string=} replacement
         * @returns {string}
         */

        function replace(str, regex, replacement){

            if(typeof replacement === 'undefined'){

                for(var i = 0; i < /** @type {Array} */ (regex).length; i += 2){

                    str = str.replace(regex[i], regex[i + 1]);
                }

                return str;
            }
            else{

                return str.replace(/** @type {!RegExp} */ (regex), replacement);
            }
        }

        /**
         * @param {Array} map
         * @param {Object} dupes
         * @param {string} tmp
         * @param {string|number} id
         * @param {number} partial_score
         * @param {number} context_score
         * @param {number} threshold
         */

        function addIndex(map, dupes, tmp, id, partial_score, context_score, threshold){

            if(typeof dupes[tmp] === 'undefined'){

                var score = (

                    partial_score ?

                        ((9 - (threshold || 6)) * context_score) + ((threshold || 6) * partial_score)
                        // calcScore(tmp, content)
                    :
                        context_score
                );

                dupes[tmp] = score;

                if(score >= threshold){

                    var arr = map[((score + 0.5) | 0)];
                        arr = arr[tmp] || (arr[tmp] = []);

                    arr[arr.length] = id;
                }
            }

            return score || dupes[tmp];
        }

        /**
        * @param {!string} part
        * @param {!string} ref
        * @returns {number}
        */

        function calcScore(part, ref){

            var context_index = ref.indexOf(part);
            var partial_index = context_index - ref.lastIndexOf(" ", context_index);

            return (

                (3 / ref.length * (ref.length - context_index)) + (6 / partial_index)
            );
        }

        /**
         * @param {Object} map
         * @param {string|number} id
         */

        function removeIndex(map, id){

            if(map){

                var keys = Object.keys(map);

                for(var i = 0, length_keys = keys.length; i < length_keys; i++){

                    var key = keys[i];
                    var tmp = map[key];

                    if(tmp){

                        for(var a = 0, length_map = tmp.length; a < length_map; a++){

                            if(tmp[a] === id){

                                if(length_map === 1){

                                    delete map[key];
                                }
                                else{

                                    tmp.splice(a, 1);
                                }

                                break;
                            }
                            else if(typeof tmp[a] === 'object'){

                                removeIndex(tmp[a], id);
                            }
                        }
                    }
                }
            }
        }

        /**
         * @param {!string} value
         * @returns {Array<?string>}
         */

        function ngram(value){

            var parts = [];

            if(!value){

                return parts;
            }

            var count_vowels = 0,
                count_literal = 0,
                count_parts = 0;

            var tmp = "";
            var length = value.length;

            for(var i = 0; i < length; i++){

                var char = value[i];
                var char_is_vowel = (

                    (char === 'a') ||
                    (char === 'e') ||
                    (char === 'i') ||
                    (char === 'o') ||
                    (char === 'u') ||
                    (char === 'y')
                );

                if(char_is_vowel){

                    count_vowels++;
                }
                else{

                    count_literal++;
                }

                if(char !== ' ') {

                    tmp += char;
                }

                //console.log(tmp);

                // dynamic n-gram sequences

                if((char === ' ') || (

                    (count_vowels >= (length > 8 ? 2 : 1)) &&
                    (count_literal >= 2)

                ) || (

                    (count_vowels >= 2) &&
                    (count_literal >= (length > 8 ? 2 : 1))

                ) || (i === length - 1)){

                    if(tmp){

                        if(parts[count_parts] && (tmp.length > 2)){

                            count_parts++;
                        }

                        if(parts[count_parts]){

                            parts[count_parts] += tmp;
                        }
                        else{

                            parts[count_parts] = tmp;
                        }

                        if(char === ' '){

                            count_parts++;
                        }

                        tmp = "";
                    }

                    count_vowels = 0;
                    count_literal = 0;
                }
            }

            return parts;
        }

        /**
         * @param {!string} string
         * @returns {string}
         */

        function collapseRepeatingChars(string){

            var collapsed_string = '',
                char_prev = '',
                char_next = '';

            for(var i = 0; i < string.length; i++){

                var char = string[i];

                if(char !== char_prev){

                    if(i && (char === 'h')){

                        var char_prev_is_vowel = (

                            (char_prev === 'a') ||
                            (char_prev === 'e') ||
                            (char_prev === 'i') ||
                            (char_prev === 'o') ||
                            (char_prev === 'u') ||
                            (char_prev === 'y')
                        );

                        var char_next_is_vowel = (

                            (char_next === 'a') ||
                            (char_next === 'e') ||
                            (char_next === 'i') ||
                            (char_next === 'o') ||
                            (char_next === 'u') ||
                            (char_next === 'y')
                        );

                        if((char_prev_is_vowel && char_next_is_vowel) || (char_prev === ' ')){

                            collapsed_string += char;
                        }
                    }
                    else{

                        collapsed_string += char;
                    }
                }

                char_next = (

                    (i === (string.length - 1)) ?

                        ''
                    :
                        string[i + 1]
                );

                char_prev = char;
            }

            return collapsed_string;
        }

        /**
         * @param {Array<string>} words
         * @param encoder
         * @returns {Object<string, string>}
         */

        function initFilter(words, encoder){

            var final = {};

            if(words){

                for(var i = 0; i < words.length; i++){

                    var word = encoder ? encoder.call(global_encoder, words[i]) : words[i];

                    final[word] = String.fromCharCode((65000 - words.length) + i);
                }
            }

            return final;
        }

        /**
         * @param {Object<string, string>} stemmer
         * @param encoder
         * @returns {Array}
         */

        function initStemmer(stemmer, encoder){

            var final = [];

            if(stemmer){

                var count = 0;

                for(var key in stemmer){

                    if(stemmer.hasOwnProperty(key)){

                        var tmp = encoder ? encoder.call(global_encoder, key) : key;

                        final[count++] = regex('(?=.{' + (tmp.length + 3) + ',})' + tmp + '$');
                        final[count++] = encoder ? encoder.call(global_encoder, stemmer[key]) : stemmer[key];
                    }
                }
            }

            return final;
        }

        /**
         * @param {string} a
         * @param {string} b
         * @returns {number}
         */

        function sortByLengthDown(a, b){

            var diff = a.length - b.length;

            return (

                diff < 0 ?

                    1
                :(
                    diff > 0 ?

                        -1
                    :
                        0
                )
            );
        }

        /**
         * @param {Array<number|string>} a
         * @param {Array<number|string>} b
         * @returns {number}
         */

        function sortByLengthUp(a, b){

            var diff = a.length - b.length;

            return (

                diff < 0 ?

                    -1
                :(
                    diff > 0 ?

                        1
                    :
                        0
                )
            );
        }

        /**
         * @param {!Array<Array<number|string>>} arrays
         * @param {number=} limit
         * @param {boolean=} suggest
         * @returns {Array}
         */

        function intersect(arrays, limit, suggest) {

            var result = [];
            var suggestions = [];
            var length_z = arrays.length;

            if(length_z > 1){

                // pre-sort arrays by length up

                arrays.sort(sortByLengthUp);

                // fill initial map

                var check = {};
                var arr = arrays[0];
                var length = arr.length;
                var i = 0;

                while(i < length) {

                    check[arr[i++]] = 1;
                }

                // loop through arrays

                var tmp, count = 0;
                var z = 1;

                while(z < length_z){

                    // get each array one by one

                    var found = false;
                    var is_final_loop = (z === (length_z - 1));

                    suggestions = [];
                    arr = arrays[z];
                    length = arr.length;
                    i = -1;

                    while(i < length){

                        var check_val = check[tmp = arr[++i]];

                        if(check_val === z){

                            // fill in during last round

                            if(is_final_loop){

                                result[count++] = tmp;

                                if(limit && (count === limit)){

                                    return result;
                                }
                            }

                            // apply count status

                            found = true;
                            check[tmp] = z + 1;
                        }
                        else if(suggest){

                            var current_suggestion = suggestions[check_val] || (suggestions[check_val] = []);

                            current_suggestion[current_suggestion.length] = tmp;
                        }
                    }

                    if(!found && !suggest){

                        break;
                    }

                    z++;
                }

                if(suggest){

                    limit || (limit = 1000);
                    count = result.length;
                    length = suggestions.length;

                    if((count < limit) && length){

                        for(z = length - 1; z >= 0; z--){

                            tmp = suggestions[z];

                            if(tmp){

                                for(i = 0; i < tmp.length; i++){

                                    result[count++] = tmp[i];

                                    if(limit && (count === limit)){

                                        return result;
                                    }
                                }
                            }
                        }
                    }
                }
            }
            else if(length_z){

                result = arrays[0];

                if(limit && /*result &&*/ (result.length > limit)){

                    // Note: do not modify the original index array!

                    result = result.slice(0, limit);
                }

                // Note: handle references to the original index array
                //return result.slice(0);
            }

            return result;
        }

        /**
         * @param {!Array<Array<number|string>>} arrays
         * @param {number=} limit
         * @returns {Array}
         */

        /*
        function intersect_3d(arrays, limit) {

            var result = [];
            var length_z = arrays.length;

            if(length_z > 1){

                // pre-sort arrays by length up

                arrays.sort(sortByLengthUp);

                var arr_tmp = arrays[0];

                for(var a = 0; a < arr_tmp.length; a++){

                    // fill initial map

                    var check = {};
                    var arr = arr_tmp[a];
                    var length = arr.length;
                    var i = 0;

                    while(i < length) {

                        check[arr[i++]] = 1;
                    }
                }

                // loop through arrays

                var tmp, count = 0;
                var z = 1;

                while(z < length_z){

                    // get each array one by one

                    var found = false;

                    var arr_tmp = arrays[0];

                    for(var a = 0; a < arr_tmp.length; a++){

                        arr = arr_tmp[a];
                        length = arr.length;
                        i = 0;

                        while(i < length){

                            if((check[tmp = arr[i++]]) === z){

                                // fill in during last round

                                if(z === (length_z - 1)){

                                    result[count++] = tmp;

                                    if(limit && (count === limit)){

                                        found = false;
                                        break;
                                    }
                                }

                                // apply count status

                                found = true;
                                check[tmp] = z + 1;
                            }
                        }
                    }

                    if(!found){

                        break;
                    }

                    z++;
                }
            }
            else if(length_z){

                result = result.concat.apply(result, arrays[0]);

                if(limit && result && (result.length > limit)){

                    // Note: do not touch original array!

                    result = result.slice(0, limit);
                }
            }

            return result;
        }
        */

        /**
         * Fastest intersect method for 2 sorted arrays so far
         * @param {!Array<number|string>} a
         * @param {!Array<number|string>} b
         * @param {number=} limit
         * @returns {Array}
         */

        function intersect_sorted(a, b, limit){

            var result = [];

            var length_a = a.length,
                length_b = b.length;

            if(length_a && length_b){

                var x = 0, y = 0, count = 0;

                var current_a = 0,
                    current_b = 0;

                while(true){

                    if((current_a || (current_a = a[x])) ===
                       (current_b || (current_b = b[y]))){

                        result[count++] = current_a;

                        current_a = current_b = 0;
                        x++;
                        y++;
                    }
                    else if(current_a < current_b){

                        current_a = 0;
                        x++;
                    }
                    else{

                        current_b = 0;
                        y++;
                    }

                    if((x === length_a) || (y === length_b)){

                        break;
                    }
                }
            }

            return result;
        }

        /**
         * @param {FlexSearch} ref
         */

        function runner(ref){

            var async = ref.async;
            var current;

            if(async){

                ref.async = false;
            }

            if(ref._stack_keys.length){

                var start = time();
                var key;

                while((key = ref._stack_keys.shift()) || (key === 0)){

                    current = ref._stack[key];

                    switch(current[0]){

                        case enum_task.add:

                            ref.add(current[1], current[2]);
                            break;

                        // case enum_task.update:
                        //
                        //     ref.update(current[1], current[2]);
                        //     break;

                        case enum_task.remove:

                            ref.remove(current[1]);
                            break;
                    }

                    ref._stack[key] = null;
                    delete ref._stack[key];

                    if((time() - start) > 100){

                        break;
                    }
                }

                if(ref._stack_keys.length){

                    register_task(ref);
                }
            }

            if(async){

                ref.async = async;
            }
        }

        /**
         * @param {FlexSearch} ref
         */

        function register_task(ref){

            ref._timer || (

                ref._timer = queue(function(){

                    ref._timer = null;

                    runner(ref);

                }, 1, 'search-async-' + ref.id)
            );
        }

        /**
         * @returns {number}
         */

        function time(){

            return (

                typeof performance !== 'undefined' ?

                    performance.now()
                :
                    (new Date()).getTime()
            );
        }

        function add_worker(id, core, options, callback){

            var thread = register_worker(

                // name:
                'flexsearch',

                // id:
                'id' + id,

                // worker:
                function(){

                    var id;

                    /** @type {FlexSearch} */
                    var flexsearch;

                    /** @lends {Worker} */
                    self.onmessage = function(event){

                        var data = event['data'];

                        if(data){

                            // if(flexsearch.debug){
                            //
                            //     console.log("Worker Job Started: " + data['id']);
                            // }

                            if(data['search']){

                                var results = flexsearch['search'](data['content'],

                                    data['threshold'] ?

                                        {
                                            'limit': data['limit'],
                                            'threshold': data['threshold']
                                        }
                                    :
                                        data['limit']
                                );

                                /** @lends {Worker} */
                                self.postMessage({

                                    'id': id,
                                    'content': data['content'],
                                    'limit': data['limit'],
                                    'result':results
                                });
                            }
                            else if(data['add']){

                                flexsearch['add'](data['id'], data['content']);
                            }
                            else if(data['update']){

                                flexsearch['update'](data['id'], data['content']);
                            }
                            else if(data['remove']){

                                flexsearch['remove'](data['id']);
                            }
                            else if(data['reset']){

                                flexsearch['reset']();
                            }
                            else if(data['info']){

                                var info = flexsearch['info']();

                                info['worker'] = id;

                                if(flexsearch.debug){

                                    console.log(info);
                                }

                                /** @lends {Worker} */
                                //self.postMessage(info);
                            }
                            else if(data['register']){

                                id = data['id'];

                                data['options']['cache'] = false;
                                data['options']['async'] = true;
                                data['options']['worker'] = false;

                                flexsearch = new Function(

                                    data['register'].substring(

                                        data['register'].indexOf('{') + 1,
                                        data['register'].lastIndexOf('}')
                                    )
                                )();

                                flexsearch = new flexsearch(data['options']);
                            }
                        }
                    };
                },

                // callback:
                function(event){

                    var data = event['data'];

                    if(data && data['result']){

                        callback(data['id'], data['content'], data['result'], data['limit']);
                    }
                    else{

                        if(SUPPORT_DEBUG && options['debug']){

                            console.log(data);
                        }
                    }
                },

                // cores:
                core
            );

            var fn_str = factory.toString();

            options['id'] = core;

            thread.postMessage(core, {

                'register': fn_str,
                'options': options,
                'id': core
            });

            return thread;
        }
    })(
        // Xone Worker Handler Fallback

        SUPPORT_WORKER ? (function register_worker(){

            var worker_stack = {};
            var inline_is_supported = !!((typeof Blob !== 'undefined') && (typeof URL !== 'undefined') && URL.createObjectURL);

            return (

                /**
                 * @param {!string} _name
                 * @param {!number|string} _id
                 * @param {!Function} _worker
                 * @param {!Function} _callback
                 * @param {number=} _core
                 */

                function(_name, _id, _worker, _callback, _core){

                    var name = _name;
                    var worker_payload = (

                        inline_is_supported ?

                            /* Load Inline Worker */

                            URL.createObjectURL(

                                new Blob([

                                    'var SUPPORT_WORKER = true;' +
                                    'var SUPPORT_BUILTINS = ' + (SUPPORT_BUILTINS ? 'true' : 'false') + ';' +
                                    'var SUPPORT_DEBUG = ' + (SUPPORT_DEBUG ? 'true' : 'false') + ';' +
                                    'var SUPPORT_CACHE = ' + (SUPPORT_CACHE ? 'true' : 'false') + ';' +
                                    'var SUPPORT_ASYNC = ' + (SUPPORT_ASYNC ? 'true' : 'false') + ';' +
                                    '(' + _worker.toString() + ')()'
                                ],{
                                    'type': 'text/javascript'
                                })
                            )
                        :

                            /* Load Extern Worker (but also requires CORS) */

                            '../' + name + '.js'
                    );

                    name += '-' + _id;

                    worker_stack[name] || (worker_stack[name] = []);

                    worker_stack[name][_core] = new Worker(worker_payload);
                    worker_stack[name][_core]['onmessage'] = _callback;

                    if(SUPPORT_DEBUG){

                        console.log('Register Worker: ' + name + '@' + _core);
                    }

                    return {

                        'postMessage': function(id, data){

                            worker_stack[name][id]['postMessage'](data);
                        }
                    };
                }
            );
        })() : false

    ), this);

    /** --------------------------------------------------------------------------------------
     * UMD Wrapper for Browser and Node.js
     * @param {!string} name
     * @param {!Function|Object} factory
     * @param {!Function|Object=} root
     * @suppress {checkVars}
     * @const
     */

    function provide(name, factory, root){

        var prop;

        // AMD (RequireJS)
        if((prop = root['define']) && prop['amd']){

            prop([], function(){

                return factory;
            });
        }
        // Closure (Xone)
        else if((prop = root['modules'])){

            prop[name.toLowerCase()] = factory;
        }
        // CommonJS (Node.js)
        else if(typeof module !== 'undefined'){

            /** @export */
            module.exports = factory;
        }
        // Global (window)
        else{

            root[name] = factory;
        }
    }

}).call(this);
