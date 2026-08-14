#!/usr/bin/env node
/**
 * @file File header manager
 *
 * Behaviour matrix:
 *
 * flags                  | report per-file fixes | report remaining errors | add missing | move position
 * -----------------------|-----------------------|--------------------------|-------------|---------------
 * (none)                 | no                    | yes                      | no          | no
 * --report               | no                    | yes                      | no          | no
 * --fix                  | yes (unless --quiet)  | yes (unless --quiet)     | yes         | no
 * --fix-missing          | yes (unless --quiet)  | no                       | yes         | no
 * --fix-position         | yes (unless --quiet)  | no                       | no          | yes
 * --fix-all              | yes (unless --quiet)  | yes (unless --quiet)     | yes         | yes
 * --fix-missing --report | yes (unless --quiet)  | yes                      | yes         | no
 * --fix-all --quiet      | yes (unless --quiet)  | yes                      | yes         | yes
 * --quiet (any fix mode) | no                    | no                       | -           | -
 *
 * Legend in output:
 *   m = missing header
 *   p = position wrong (header not right after shebang/top)
 *   s = shebang exists in file
 *
 * @version 1.1.1
 */

import fs from 'node:fs';
import path from 'node:path';

import { globSync } from 'glob';
import { minimatch } from 'minimatch';
import { hideBin } from 'yargs/helpers';
import yargs from 'yargs/yargs';

const VERSION = '1.1.2';

const DEFAULT_PATTERNS = [ '**/*.{js,ts,tsx,mjs,cjs}' ];

const DEFAULT_TEST_GLOB = [ '**/*.spec.{ts,tsx,mjs,cjs}', '**/*.test.{ts,tsx,mjs,cjs}' ];

const DEFAULT_IGNORES = [
  '**/node_modules/**',
  'dist/**',
  'tests/fixtures/**',
];

console.error( `\n${ yargs( hideBin( process.argv ) )
  .help( false ).argv.$0 } v${ VERSION }\n` );

const argv = yargs( hideBin( process.argv ) )
  .usage( 'Usage: $0 [options] [globs...] [options]' )
  .version( VERSION )
  .alias( 'version', 'v' )
  .positional( 'globs', {
    describe: `File paths or glob patterns`,
    type:     'string',
    array:    true,
    default:  [ ...DEFAULT_PATTERNS ],
  } )
  .option( 'ignore-clear', {
    alias:    'c',
    type:     'boolean',
    default:  false,
    describe: `Clear all default ignores before adding custom ones (default: ${ JSON.stringify( DEFAULT_IGNORES ) })`,
  } )
  .option( 'ignore', {
    alias:    'i',
    type:     'string',
    array:    true,
    describe: 'Adds custom ignore pattern (can be repeated)',
  } )
  .nargs( 'ignore', 1 )
  .option( 'fix-missing', {
    alias:    'M',
    type:     'boolean',
    default:  false,
    describe: 'Add missing @file|@fileoverview|@overview header',
  } )
  .option( 'fix-position', {
    alias:    'p',
    type:     'boolean',
    default:  false,
    describe: 'Move existing @file headers to correct position',
  } )
  .option( 'fix', {
    alias:    'f',
    type:     'boolean',
    default:  false,
    describe: 'Alias for --fix-position --fix-test --report: safe default for quick fixes',
  } )
  .option( 'fix-all', {
    alias:    'F',
    type:     'boolean',
    default:  false,
    describe: 'Alias for --fix-position --fix-missing: Move existing header and ADD default header (--test is irrelevant here)',
  } )
  .option( 'fix-test', {
    alias:    'T',
    type:     'string',
    array:    true,
    describe: `Glob(s) for files to auto-add missing headers when running --fix(default when --fix; default: ${ JSON.stringify( DEFAULT_TEST_GLOB ) })`,
  } )
  .coerce( 'fix-test', ( arg ) => Array.isArray( arg ) ? arg : arg === true ? [] : [ arg ] )
  .option( 'report', {
    alias:    'r',
    type:     'boolean',
    default:  false,
    describe: 'If run with --fix-position/--fix-missing, also report path with remaining missing/misplaced headers',
  } )
  .option( 'quiet', {
    alias:    'q',
    type:     'boolean',
    default:  false,
    describe: 'Suppress per-file fix messages (still shows summary)',
  } )
  .example( '$0 "src/**/*.ts"', 'Report only' )
  .example( '$0 --fix-all', 'Fix everything, show changed files' )
  .example( '$0 --fix', `Fix header position showing file path of changed and erroneous files, add missing header to ${ JSON.stringify( DEFAULT_TEST_GLOB ) }` )
  .example( '$0 --fix --quiet', 'Fix header position without showing file names' )
  .example( '$0 --fix --report', 'Fix header position and show remaining issues' )
  .help()
  .alias( 'help', 'h' )
  .argv;


// Simple ANSI colors
const colors = {
  red:    ( s ) => `\x1b[31m${ s }\x1b[0m`,
  green:  ( s ) => `\x1b[32m${ s }\x1b[0m`,
  yellow: ( s ) => `\x1b[33m${ s }\x1b[0m`,
  gray:   ( s ) => `\x1b[90m${ s }\x1b[0m`,
  cyan:   ( s ) => `\x1b[36m${ s }\x1b[0m`,
};

if ( argv.fix )
{
  argv.fixPosition = true;
  argv.report ||= !argv.quiet;
  argv.fixTest ||= DEFAULT_TEST_GLOB;
}

const shouldFixMissing = argv.fixAll || argv.fixMissing || argv.fix;

const shouldFixPosition = argv.fixAll || argv.fixPosition;

const isFixMode = shouldFixMissing || shouldFixPosition;

const shouldReport = argv.report || !isFixMode;

const quiet = argv.quiet;

const testGlobs = isFixMode ? normalizePattern( argv.fixTest || [] ) || DEFAULT_TEST_GLOB : undefined;

const globs = argv._.length > 0 ? normalizePattern( argv._ ) : DEFAULT_PATTERNS;

let ignores = ( argv.ignoreClear ) ? [] : [ ...DEFAULT_IGNORES ];

normalizePattern( argv.ignore, ignores );

if ( isFixMode )
{
  let mode = `Mode:   FIX (${ shouldFixMissing || testGlobs ? 'add missing' + ( testGlobs ? ' (test)' : '' ) : '' }${ shouldFixMissing && shouldFixPosition ? ' + ' : '' }${ shouldFixPosition ? 'move position' : '' })`;

  if ( quiet )
  {
    mode += ' QUIET (no per-file fix messages)';
  }

  if ( shouldReport )
  {
    mode += ' REPORT (remaining issues';
  }

  console.error( mode );
}
else
{
  console.error( 'Mode:   REPORT only' );
}

console.error( `Match:  ${ globs.join( ', ' ) }` );

if ( testGlobs )
{
  console.error( `Test:   ${ testGlobs.join( ', ' ) }` );
}

console.error( `Ignore: ${ ignores.join( ', ' ) }` );

const files = globSync( globs, {
  ignore: ignores,
  nodir:  true,
} );

console.error( `Found:  ${ files.length } files` );

console.error( '' );

let changedCount = 0;

let addedCount = 0;

let movedCount = 0;

let erroneousCount = 0;

let missingCount = 0;

let misplacedCount = 0;

let printed = false;

for ( const file of files )
{
  const content = fs.readFileSync( file, 'utf-8' );

  const lines = content.split( '\n' );

  // Shebang detection
  const hasShebang = lines.length > 0 && lines[0].startsWith( '#!' );

  const shebangEnd = hasShebang ? 1 : 0;

  // Find existing file-overview block
  let blockStart = -1;

  let blockEnd = -1;

  for ( let i = shebangEnd; i < Math.min( shebangEnd + 40, lines.length ); i++ )
  {
    if ( lines[i]
      .trimStart()
      .startsWith( '/**' ) )
    {
      blockStart = i;
      for ( let j = i + 1; j < lines.length; j++ )
      {
        if ( lines[j].includes( '*/' ) )
        {
          blockEnd = j;
          break;
        }
      }

      if ( blockStart !== -1 && blockEnd !== -1 )
      {
        const blockText = lines.slice( blockStart, blockEnd + 1 )
          .join( '\n' );

        if ( /@file\b|@fileoverview\b|@overview\b/.test( blockText ) )
        {
          break;
        }
      }
      blockStart = -1;
      blockEnd = -1;
    }
  }

  const hasHeader = blockStart !== -1;

  const isMisplaced = hasHeader && blockStart > shebangEnd;

  if ( !hasHeader )
  {
    missingCount++;
  }
  if ( isMisplaced )
  {
    misplacedCount++;
  }
  if ( !hasHeader || isMisplaced )
  {
    erroneousCount++;
  }

  let action = 'none';

  let headerLines = [];

  if ( hasHeader && shouldFixPosition && isMisplaced )
  {
    action = 'move';
    headerLines = lines.slice( blockStart, blockEnd + 1 );
  }
  else if ( !hasHeader && ( shouldFixMissing || ( testGlobs && matchesTest( file, testGlobs ) ) ) )
  {
    action = 'add';

    const relative = path.relative( process.cwd(), file )
      .replace( /\\/g, '/' );

    headerLines = [
      '/**',
      ` * @file ${ relative }`,
      ' */',
    ];
  }

  if ( action === 'none' )
  {
    if ( shouldReport && ( !hasHeader || isMisplaced ) )
    {
      const relative = path.relative( process.cwd(), file )
        .replace( /\\/g, '/' );

      console.log( `err: ${ !hasHeader ? 'm' : isMisplaced ? 'p' : '-' } ${ hasShebang ? 's' : '-' } ${ relative }` );

      printed = true;
    }
    continue;
  }

  // Build new content
  const newLines = [];

  if ( hasShebang )
  {
    newLines.push( lines[0].trimEnd() );
  }

  newLines.push( ...headerLines );
  newLines.push( '' );

  if ( action === 'move' )
  {
    newLines.push( ...lines.slice( shebangEnd, blockStart ) );
  }

  const restStart = hasHeader ? blockEnd + 1 : shebangEnd;

  const rest = lines.slice( restStart )
    .join( '\n' )
    .trimStart();

  if ( rest )
  {
    newLines.push( rest );
  }

  const newContent = newLines.join( '\n' );

  if ( newContent === content )
  {
    continue;
  }

  if ( isFixMode && !quiet )
  {
    const relative = path.relative( process.cwd(), file )
      .replace( /\\/g, '/' );

    console.log( `fix: ${ action === 'add' ? 'm' : action === 'move' ? 'p' : '-' } ${ hasShebang ? 's' : '-' } ${ relative }` );

    printed = true;
  }

  if ( isFixMode )
  {
    if ( action === 'add' )
    {
      addedCount++;
    }
    if ( action === 'move' )
    {
      movedCount++;
    }
    changedCount++;
    fs.writeFileSync( file, newContent, 'utf-8' );
  }
}

if ( printed )
{
  console.error();
}

console.error( 'Summary:' );
console.error( `  Files scanned:      ${ files.length }` );


console.error( formatMessage( `Headers added:     `, addedCount, colors.green ) );
console.error( formatMessage( `Headers moved:     `, movedCount, colors.green ) );
console.error( formatMessage( `Changed total:     `, changedCount, colors.yellow ) );
console.error( formatMessage( `Still missing:     `, missingCount - addedCount, colors.yellow, colors.green ) );
console.error( formatMessage( `Still misplaced:   `, misplacedCount - movedCount, colors.yellow, colors.green ) );
console.error( formatMessage( `Total erroneous:   `, erroneousCount - changedCount, colors.red, colors.green ) );

if ( !isFixMode && erroneousCount > 0 )
{
  console.error( '\nUse --fix-missing, --fix-position or --fix to apply changes' );
}

console.error();

if ( files.length === 0 )
{
  console.error( colors.red( 'WARNING: no files matched!\n' ) );

  process.exit( 99 );
}

if ( !isFixMode )
{
  if ( ( missingCount - addedCount ) && ( misplacedCount - movedCount ) )
  {
    process.exit( 3 );
  }
  if ( missingCount - addedCount > 0 )
  {
    process.exit( 2 );
  }
  if ( misplacedCount - movedCount > 0 )
  {
    process.exit( 1 );
  }
}

process.exit( 0 );


/**
 * Checks if the file matches any test glob.
 * @param {string} filePath
 * @param {string[]} testGlobs
 * @returns {boolean}
 */
function matchesTest( filePath, testGlobs )
{
  const relative = path.relative( process.cwd(), filePath )
    .replace( /\\/g, '/' );

  return testGlobs.some( glob => minimatch( relative, glob ) );
}

/**
 * @param {string[]} argument
 * @param {string[]} result
 * @returns {string[]}
 */
function normalizePattern( argument, result = [] )
{
  if ( !argument || argument.length === 0 )
  {
    return undefined;
  }

  argument.forEach( p =>
  {
    if ( p.includes( '*' ) )
    {
      result.push( p );

      return;
    }

    if ( fs.existsSync( p ) )
    {
      result.push( p.replace( /\\/g, '/' )
        .replace( /^\.?\/?/, '' ) );

      return;
    }

    result.push( p );
  } );

  return result;

}

/**
 * @param {string} message
 * @returns {string}
 */
function echo( message )
{
  return message;
}


/**
 * @param {string} header
 * @param {number} count
 * @param {function(string): string} colorFunction
 * @param {function(string): string} colorOnZeroFunction
 * @returns string
 */
function formatMessage( header, count, colorFunction, colorOnZeroFunction = echo )
{
  if ( count )
  {
    return colorFunction( `  ${ header } ${ count }` );
  }

  return colorOnZeroFunction( `  ${ header } ${ count }` );
}
