import Hogan from 'hogan.js';
import algoliasearch from 'algoliasearch';
import autocomplete from 'autocomplete.js';
import templates from './templates.js';
import utils from './utils.js';
import version from './version.js';
import $ from 'npm-zepto';

/**
 * Adds an autocomplete dropdown to an input field
 * @function DocSearch
 * @param  {string} options.apiKey         Read-only API key
 * @param  {string} options.indexName      Name of the index to target
 * @param  {string} options.inputSelector  CSS selector that targets the input
 * @param  {string} [options.appId]  Lets you override the applicationId used.
 * If using the default Algolia Crawler, you should not have to change this
 * value.
 * @param  {Object} [options.algoliaOptions] Options to pass the underlying Algolia client
 * @param  {Object} [options.autocompleteOptions] Options to pass to the underlying autocomplete instance
 * @return {Object}
 */
const usage = `Usage:
  documentationSearch({
  apiKey,
  indexName,
  inputSelector,
  [ appId ],
  [ algoliaOptions.{hitsPerPage} ]
  [ autocompleteOptions.{hint,debug} ]
})`;
class DocSearch {
  constructor({
    apiKey,
    indexName,
    inputSelector,
    appId = 'BH4D9OD16A',
    debug = false,
    algoliaOptions = {},
    autocompleteOptions = {
      debug: false,
      hint: false,
      autoselect: true
    },
    transformData = false,
    enhancedSearchInput = false,
    layout = 'collumns'
  }) {
    DocSearch.checkArguments({apiKey, indexName, inputSelector, debug, algoliaOptions, autocompleteOptions, transformData, enhancedSearchInput, layout});

    this.apiKey = apiKey;
    this.appId = appId;
    this.indexName = indexName;
    this.input = DocSearch.getInputFromSelector(inputSelector);
    this.algoliaOptions = {hitsPerPage: 5, ...algoliaOptions};
    let autocompleteOptionsDebug = autocompleteOptions && autocompleteOptions.debug ? autocompleteOptions.debug: false;
    autocompleteOptions.debug = debug || autocompleteOptionsDebug;
    this.autocompleteOptions = autocompleteOptions;
    this.autocompleteOptions.cssClasses = {
      prefix: 'ds'
    };

    this.isSimpleLayout = (layout === 'simple');

    this.client = algoliasearch(this.appId, this.apiKey);
    this.client.addAlgoliaAgent('docsearch.js ' + version);

    if (enhancedSearchInput) {
      DocSearch.injectSearchBox(this.input);
    }

    this.autocomplete = autocomplete(this.input, autocompleteOptions, [{
      source: this.getAutocompleteSource(transformData),
      templates: {
        suggestion: DocSearch.getSuggestionTemplate(this.isSimpleLayout),
        footer: templates.footer,
        empty: DocSearch.getEmptyTemplate()
      }
    }]);
    this.autocomplete.on(
      'autocomplete:selected',
      this.handleSelected.bind(null, this.autocomplete.autocomplete)
    )
    this.autocomplete.on(
      'autocomplete:shown',
       this.handleShown.bind(null, this.input)
    )
  }

  /**
   * Checks that the passed arguments are valid. Will throw errors otherwise
   * @function checkArguments
   * @param  {object} args Arguments as an option object
   * @returns {void}
   */
  static checkArguments(args) {
    if (!args.apiKey || !args.indexName) {
      throw new Error(usage);
    }

    if (!DocSearch.getInputFromSelector(args.inputSelector)) {
      throw new Error(`Error: No input element in the page matches ${args.inputSelector}`);
    }
  }

  static injectSearchBox(input) {
    input.before(templates.searchBox);
    input.remove();
  }

  /**
   * Returns the matching input from a CSS selector, null if none matches
   * @function getInputFromSelector
   * @param  {string} selector CSS selector that matches the search
   * input of the page
   * @returns {void}
   */
  static getInputFromSelector(selector) {
    let input = $(selector).filter('input');
    return input.length ? $(input[0]) : null;
  }

  /**
   * Returns the `source` method to be passed to autocomplete.js. It will query
   * the Algolia index and call the callbacks with the formatted hits.
   * @function getAutocompleteSource
   * @returns {function} Method to be passed as the `source` option of
   * autocomplete
   */
  getAutocompleteSource(transformData) {
    return (query, callback) => {
      this.client.search([{
        indexName: this.indexName,
        query: query,
        params: this.algoliaOptions
      }]).then((data) => {
        let hits = data.results[0].hits;
        if (transformData) {
          hits = transformData(hits) || hits;
        }
        callback(DocSearch.formatHits(hits));
      });
    };
  }

  // Given a list of hits returned by the API, will reformat them to be used in
  // a Hogan template
  static formatHits(receivedHits) {
    let clonedHits = utils.deepClone(receivedHits);
    let hits = clonedHits.map((hit) => {
      if (hit._highlightResult) {
        hit._highlightResult = utils.mergeKeyWithParent(hit._highlightResult, 'hierarchy');
      }
      return utils.mergeKeyWithParent(hit, 'hierarchy');
    });

    // Group hits by category / subcategory
    var groupedHits = utils.groupBy(hits, 'lvl0');
    $.each(groupedHits, (level, collection) => {
      let groupedHitsByLvl1 = utils.groupBy(collection, 'lvl1');
      let flattenedHits = utils.flattenAndFlagFirst(groupedHitsByLvl1, 'isSubCategoryHeader');
      groupedHits[level] = flattenedHits;
    });
    groupedHits = utils.flattenAndFlagFirst(groupedHits, 'isCategoryHeader');

    // Translate hits into smaller objects to be send to the template
    return groupedHits.map((hit) => {
      let url = DocSearch.formatURL(hit);
      let category = utils.getHighlightedValue(hit, 'lvl0');
      let subcategory = utils.getHighlightedValue(hit, 'lvl1') || category;
      let isSubcategoryDuplicate = subcategory == category;
      let displayTitle = utils.compact([
        utils.getHighlightedValue(hit, 'lvl2') || subcategory,
        utils.getHighlightedValue(hit, 'lvl3'),
        utils.getHighlightedValue(hit, 'lvl4'),
        utils.getHighlightedValue(hit, 'lvl5'),
        utils.getHighlightedValue(hit, 'lvl6')
      ]).join('<span class="aa-suggestion-title-separator"> › </span>');
      let isDisplayTitleDuplicate = displayTitle == subcategory;
      let text = utils.getSnippetedValue(hit, 'content');
      let isTextOrSubcatoryNonEmpty = (subcategory && subcategory != "") || (displayTitle && displayTitle != "");

      return {
        isCategoryHeader: hit.isCategoryHeader,
        isSubCategoryHeader: hit.isSubCategoryHeader,
        isSubcategoryDuplicate: isSubcategoryDuplicate,
        isDisplayTitleDuplicate: isDisplayTitleDuplicate,
        isTextOrSubcatoryNonEmpty: isTextOrSubcatoryNonEmpty,
        category: category,
        subcategory: subcategory,
        title: displayTitle,
        text: text,
        url: url
      };
    });
  }

  static formatURL(hit) {
    const {url, anchor} = hit;
    if (url) {
      const containsAnchor = url.indexOf('#') !== -1;
      if (containsAnchor) return url;
      else if (anchor) return `${hit.url}#${hit.anchor}`;
      return url;
    }
    else if (anchor) return `#${hit.anchor}`;
    /* eslint-disable */
    console.warn('no anchor nor url for : ', JSON.stringify(hit));
    /* eslint-enable */
    return null;
  }

  static getEmptyTemplate() {
    return (args) => {
      return Hogan.compile(templates.empty).render(args);
    };
  }

  static getSuggestionTemplate(isSimpleLayout) {
    const template = Hogan.compile(templates.suggestion);
    return (suggestion) => {
      isSimpleLayout = isSimpleLayout || false;
      return template.render({isSimpleLayout, ...suggestion});
    };
  }

  handleSelected(input, event, suggestion) {
    input.setVal('');
    window.location.href = suggestion.url;
  }

  handleShown(input, event) {
    var middleOfInput = input.offset().left + input.width() / 2;
    var middleOfWindow = $(document).width() / 2;

    if (isNaN(middleOfWindow)) {
      middleOfWindow = 900;
    }

    var alignClass = middleOfInput - middleOfWindow >= 0 ? 'algolia-autocomplete-right' : 'algolia-autocomplete-left';
    var otherAlignClass = middleOfInput - middleOfWindow < 0 ? 'algolia-autocomplete-right' : 'algolia-autocomplete-left';

    var autocompleteWrapper = $('.algolia-autocomplete');
    if (! autocompleteWrapper.hasClass(alignClass)) {
      autocompleteWrapper.addClass(alignClass)
    }

    if (autocompleteWrapper.hasClass(otherAlignClass)) {
      autocompleteWrapper.removeClass(otherAlignClass);
    }
  }
}

export default DocSearch;

