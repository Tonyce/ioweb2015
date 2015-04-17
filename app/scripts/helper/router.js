/**
 * Copyright 2015 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

 /**
  * @fileOverview The ajax-based routing for IOWA subpages.
  */

IOWA.Router = (function() {

  "use strict";

  var MASTHEAD_BG_CLASS_REGEX = /(\s|^)bg-[a-z-]+(\s|$)/;

  /**
   * Replaces in-page <script> tag in xhr'd body content with runnable script.
   *
   * @param {Node} node Container element to replace script content.
   * @private
   */
  function replaceScriptTagWithRunnableScript(node) {
    var script = document.createElement('script');
    script.text = node.text || node.textContent || node.innerHTML;
    // IE doesn't execute the script when it's appended to the middle
    // of the DOM. Append it to body instead, then remove.
    if (IOWA.Util.isIE()) {
      document.body.appendChild(script);
      document.body.removeChild(script);
    } else {
      node.parentNode.replaceChild(script, node); // FF
    }
  };

  //constructor.
  var Router = function() {};

  Router.prototype.state = {
    start: null,
    current: null,
    end: null
  };

  Router.prototype.init = function(template) {
    this.t = template;
    this.state.current = this.parseUrl(window.location.href);
    window.addEventListener('popstate', function() {
      this.navigate(window.location.href, 'page-slide-transition');
    }.bind(this));

    // On iOS, we don't have event bubbling to the document level.
    // http://www.quirksmode.org/blog/archives/2010/09/click_event_del.html
    var eventName = IOWA.Util.isIOS() || IOWA.Util.isTouchScreen() ?
        'touchstart' : 'click';

    document.addEventListener(eventName, this.onClick.bind(this));
  };

  /**
   * Navigates to a new page state. Uses ajax for data-ajax-link links.
   * @param {Event} e Event that triggered navigation.
   * @private
   */
  Router.prototype.onClick = function(e) {
    // Allow user to open page in a new tab.
    if (e.metaKey || e.ctrlKey) {
      return;
    }

    // Inject page if <a> has the data-ajax-link attribute.
    for (var i = 0; i < e.path.length; ++i) {
      var el = e.path[i];
      if (el.localName === 'a') {
        // First, record click event if link requests it.
        if (el.hasAttribute('data-track-link')) {
          IOWA.Analytics.trackEvent(
              'link', 'click', el.getAttribute('data-track-link'));
        }
        // Ignore links that go offsite.
        if (el.target) {
          return;
        }
        if (el.hasAttribute('data-ajax-link')) {
          e.preventDefault();
          e.stopPropagation();
          this.navigate(el.href, e, el);
        }
        return; // found first navigation element, quit here.
      }
    }
  };

  Router.pageExitTransitions = {
      'masthead-ripple-transition': 'playMastheadRippleTransition',
      'hero-card-transition': 'playHeroTransitionStart',
      'page-slide-transition': 'playPageSlideOut'
  };

  Router.pageEnterTransitions = {
      'masthead-ripple-transition': 'playPageSlideIn',
      'hero-card-transition': 'playHeroTransitionEnd',
      'page-slide-transition': 'playPageSlideIn'
  };

  Router.prototype.importPage = function() {
    var pageName = this.state.end.page;
    return new Promise(function(resolve, reject) {
      var importURL = pageName + '?partial';
      // TODO(ericbidelman): update call when
      // github.com/Polymer/polymer/pull/1128 lands.
      Polymer.import([importURL], function() {
        // Don't proceed if import didn't load correctly.
        var htmlImport = document.querySelector(
            'link[rel="import"][href="' + importURL + '"]');
        if (htmlImport && !htmlImport.import) {
          return;
        }
        // FF doesn't execute the <script> inside the main content <template>
        // (inside page partial import). Instead, the first time the partial is
        // loaded, find any script tags in and make them runnable by appending
        // them back to the template.
        if (IOWA.Util.isFF() || IOWA.Util.isIE()) {
          var contentTemplate = document.querySelector(
             '#template-' + pageName + '-content');
          if (!contentTemplate) {
            var containerTemplate = htmlImport.import.querySelector(
                '[data-ajax-target-template="template-content-container"]');
            var scripts = containerTemplate.content.querySelectorAll('script');
            Array.prototype.forEach.call(scripts, function(node, i) {
              replaceScriptTagWithRunnableScript(node);
            });
          }
        }
        // Update content of the page.
        resolve(htmlImport.import);
      });
    });
  }

  Router.prototype.renderTemplates = function(importContent) {
    var pageName = this.state.end.page;
    return new Promise(function(resolve, reject) {
      // Add freshly fetched templates to DOM, if not yet present.
      var newTemplates = importContent.querySelectorAll('.js-ajax-template');
      for (var i = 0; i < newTemplates.length; i++) {
        var newTemplate = newTemplates[i];
        if (!document.getElementById(newTemplate.id)) {
          document.body.appendChild(newTemplate);
        }
      }
      // Replace current templates content with new one.
      var newPageTemplates = document.querySelectorAll(
          '.js-ajax-' + pageName);
      for (var j = 0, length = newPageTemplates.length; j < length; j++) {
        var template = newPageTemplates[j];
        var templateToReplace = document.getElementById(
            template.getAttribute('data-ajax-target-template'));
        if (templateToReplace) {
          templateToReplace.setAttribute('ref', template.id);
        }
      }
      resolve();
    });
  };

  Router.prototype.runPageHandler = function(funcName) {
    var pageName = this.state.current.page;
    return new Promise(function(resolve, reject) {
      var page = IOWA.Elements.Template.pages[pageName];
      if (page && page[funcName]) {
        // If page we're going to has a load handler, run it.
        page[funcName]();
      }
      resolve();
    });
  };

  Router.prototype.updateUIstate = function() {
    var pageName = this.state.current.page;
    var pageMeta = this.t.pages[pageName];

    // Update menu/drawer/subtabs selected item.
    this.t.selectedPage = pageName;
    this.t.pages[pageName].selectedSubpage = this.state.current.subpage;
    IOWA.Elements.DrawerMenu.selected = pageName;

    // Update some elements only if navigating to a new page.
    if (this.state.current.page !== this.state.start.page) {
      document.body.id = 'page-' + pageName;
      document.title = pageMeta.title || 'Google I/O 2015';
      // This cannot be updated via data binding, because the masthead
      // is visible before the binding happens.
      IOWA.Elements.Masthead.className = IOWA.Elements.Masthead.className.replace(
        MASTHEAD_BG_CLASS_REGEX, ' ' + pageMeta.mastheadBgClass + ' ');
      // Reset subpage, since leaving the page.
      var startPage = this.state.start.page;
      this.t.pages[startPage].selectedSubpage = startPage.defaultSubpage;
      // Scroll to top of new page.
      IOWA.Elements.ScrollContainer.scrollTop = 0;
    }

    // Show correct subpage.
    var subpages = IOWA.Elements.Main.querySelectorAll('.subpage__content');
    var selectedSubpageSection = IOWA.Elements.Main.querySelector(
        '.subpage-' + this.state.current.subpage);
    if (selectedSubpageSection) {
      for (var i = 0; i < subpages.length; i++) {
        var subpage = subpages[i];
        subpage.style.display = 'none';
        subpage.classList.remove('active');
      }
      selectedSubpageSection.style.display = '';
      selectedSubpageSection.classList.add('active');
    }
    // If current href is different than the url, update it in the browser.
    if (this.state.current.href !== window.location.href) {
      history.pushState({
        'path': this.state.current.path + this.state.current.hash
      }, '', this.state.current.href);
    }
  };

  // TODO: Remove bind() for performance.
  Router.prototype.runPageTransition = function(e, source) {
    var transitionAttribute = source ?
        source.getAttribute('data-transition') : null;
    var transition = transitionAttribute || 'page-slide-transition';
    var router = this;
    // Start transition.
    IOWA.Elements.Template.fire('page-transition-start');
    // Play exit sequence.
    IOWA.PageAnimation[Router.pageExitTransitions[transition]](
        this.state.start.page, this.state.end.page, e, source)
      // Run page's custom unload handlers.
      .then(this.runPageHandler.bind(this, 'unload'))
      // Load the new page.
      .then(this.importPage.bind(this))
      .then(this.renderTemplates.bind(this))
      .then(function() {
        return new Promise(function(resolve, reject) {
          // Update state of the page in Router.
          router.state.current = router.parseUrl(router.state.end.href);
          // Update UI state based on the router's state.
          router.updateUIstate();
          resolve();
        });
      })
      // Run page's custom load handlers.
      .then(this.runPageHandler.bind(this, 'load'))
      // Play entry sequence.
      .then(IOWA.PageAnimation[Router.pageEnterTransitions[transition]])
      .then(function() {
        // End transition.
        IOWA.Elements.Template.fire('page-transition-done');
      }.bind(this));
  };


  Router.prototype.runSubpageTransition = function() {
    var oldSubpage = IOWA.Elements.Main.querySelector(
        '.subpage-' + this.state.start.subpage);
    var newSubpage = IOWA.Elements.Main.querySelector(
        '.subpage-' + this.state.end.subpage);
    // Play exit sequence.
    IOWA.PageAnimation.playSectionSlideOut(oldSubpage)
      .then(function() {
        // Update state of the page in Router.
        this.state.current = this.parseUrl(this.state.end.href);
        // Update UI state based on the router's state.
        this.updateUIstate();
      }.bind(this))
      // Play entry sequence.
      .then(IOWA.PageAnimation.playSectionSlideIn.bind(null, newSubpage));
  };


  Router.prototype.navigate = function(href, e, source) {
    // Copy current state to startState.
    this.state.start = this.parseUrl(this.state.current.href);
    this.state.end = this.parseUrl(href);
    // Navigate to a new page.
    if (this.state.start.page !== this.state.end.page) {
      this.runPageTransition(e, source);
    } else if (this.state.start.subpage !== this.state.end.subpage) {
      this.runSubpageTransition();
    }
  };

  /**
   * Extracts page's state from the url.
   * Url structure:
   *    http://<origin>/io2015/<page>?<search>#<subpage>/<resourceId>
   * @param {string} url The page's url.
   */
  Router.prototype.parseUrl = function(url) {
    var parser = new URL(url);
    var hashParts = parser.hash.replace('#', '').split('/');
    var params = {};
    if (parser.search) {
      var paramsList = parser.search.replace('?', '').split('&');
      for (var i = 0; i < paramsList.length; i++) {
        var paramsParts = paramsList[i].split('=');
        params[paramsParts[0]] = decodeURIComponent(paramsParts[1]);
      }
    }
    var page = parser.pathname.replace(window.PREFIX + '/', '') || 'home';
    // If pages data is accessible, find default subpage.
    var pageMeta = (this.t && this.t.pages) ? this.t.pages[page] : null;
    var defaultSubpage = pageMeta ? pageMeta.defaultSubpage : '';
    // Get subpage from url or set to the default subpage for this page.
    var subpage = hashParts[0] || defaultSubpage;
    return {
      'pathname': parser.pathname,
      'search': parser.search,
      'hash': parser.hash,
      'href': parser.href,
      'page': page,
      'subpage': subpage,
      'resourceId': hashParts[1],
      'params': params
    };
  };

  /**
   * Builds a url from the page's state details.
   * Url structure:
   *    http://<origin>/io2015/<page>?<search>#<subpage>/<resourceId>
   * @param {string} page Name of the page.
   * @param {string} subpage Name of the subpage.
   * @param {string} resourceId Resource identifier.
   * @param {string} search Encoded search string.
   */
  Router.prototype.composeUrl = function(page, subpage, resourceId, search) {
    return [window.location.origin, window.PREFIX, '/', page, search,
        '#', subpage || '', '/', resourceId || ''].join('');
  }

  return new Router();

})();
