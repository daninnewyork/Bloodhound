module.exports = function(config) {

    'use strict';

    config.set({

        basePath: './',

        browsers: ['PhantomJS'],

        frameworks: ['jasmine', 'requirejs'],

        files: [
            'test/config.js',
            'app/bower_components/angular/angular.js',
            'app/bower_components/angular-mocks/angular-mocks.js',
            {pattern: 'app/bower_components/**/*.js', included: false},
            {pattern: 'app/src/**/*.js', included: false, watched: true},
            {pattern: 'test/**/*.js', included: false, watched: true}
        ],

        preprocessors: {
            'app/src/**/*.js': ['coverage']
        },

        autoWatch: true,
        singleRun: false,

        reporters: ['story', 'coverage', 'brackets'],

        coverageReporter: {
            reporters: [
                {type: 'text-summary', dir: 'build/dev/coverage'},
                {type: 'html', dir: 'build/dev/coverage'}
            ]
        },

        junitReporter: {
            outputFile: 'build/dev/unit.xml',
            suite: 'unit'
        }

    });
};
