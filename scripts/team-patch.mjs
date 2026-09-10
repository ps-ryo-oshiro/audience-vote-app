#!/usr/bin/env node
/**
 * team-patch.mjs
 *
 * 審査アプリ（judge-app）のチームデータをもとに、投票アプリ専用DB
 * （audience-vote-2026）の `/audienceApp/teams` へ適用する multi-path
 * パッチ（JSON）を標準出力に生成するツール。
 *
 * 設計上の重要な制約（design.md「Team Patch Script」参照）:
 * - judge-app のプロジェクトID・URL・接続値は、このスクリプトには一切書かない。
 *   実行時に `--judge <file>` として、事前に `database:get` で取得した
 *   JSONファイルを渡す（このスクリプト自身は judge-app に接続しない）。
 * - 標準ライブラリのみを使用する（Node.js 24）。
 * - 出力は標準出力に書く patch JSON のみ。副作用のある書き込みはしない
 *   （実際のDBへの適用は `firebase-tools database:update` を別途叩く）。
 *
 * サブコマンド:
 *   seed     --judge <file> --finalists <No,No,...> [--current <file>]
 *   videos   （タスク2.2で実装予定・未実装）
 *   rename   （タスク2.2で実装予定・未実装）
 */

import { readFileSync, existsSync } from 'node:fs';
import { parseArgs } from 'node:util';

const SECTION_LABEL_TO_CODE = {
  'ライフ部門': 'life',
  'ワーク部門': 'work',
  'ローカル部門': 'local',
};

const REQUIRED_FINALIST_COUNT = 12;

function logError(message) {
  process.stderr.write(`[team-patch] エラー: ${message}\n`);
}

function logWarn(message) {
  process.stderr.write(`[team-patch] 警告: ${message}\n`);
}

function logInfo(message) {
  process.stderr.write(`[team-patch] ${message}\n`);
}

function fail(message) {
  logError(message);
  process.exit(1);
}

function teamIdFromNo(no) {
  return `entry-${String(no).padStart(2, '0')}`;
}

/**
 * JSONファイルを読み込む。
 * @param {string} path
 * @param {{ allowMissing?: boolean }} options allowMissing: true の場合、
 *   ファイルが存在しない・空文字であれば null を返す（例外にしない）
 */
function readJsonFile(path, { allowMissing = false } = {}) {
  if (!existsSync(path)) {
    if (allowMissing) return null;
    fail(`ファイルが見つかりません: ${path}`);
  }
  const raw = readFileSync(path, 'utf8');
  if (raw.trim() === '') {
    if (allowMissing) return null;
    fail(`ファイルが空です: ${path}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail(`JSONの解析に失敗しました (${path}): ${err.message}`);
  }
  return null; // unreachable (fail exits the process)
}

/**
 * "1,2,3" 形式の文字列をエントリーNoの配列に変換する。
 */
function parseFinalistsArg(str) {
  if (!str || str.trim() === '') {
    fail('--finalists には少なくとも1件のエントリーNoを指定してください');
  }
  const nos = str
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const n = Number(s);
      if (!Number.isInteger(n)) {
        fail(`--finalists に数値でない値があります: "${s}"`);
      }
      return n;
    });
  if (nos.length === 0) {
    fail('--finalists には少なくとも1件のエントリーNoを指定してください');
  }
  return nos;
}

/**
 * seed サブコマンド:
 * judge-app のチーム一覧・本戦確定Noの一覧・現在のチーム一覧から、
 * `/audienceApp/teams` への multi-path パッチを生成する。
 */
function runSeed(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        judge: { type: 'string' },
        finalists: { type: 'string' },
        current: { type: 'string' },
      },
      allowPositionals: false,
      strict: true,
    }));
  } catch (err) {
    fail(`引数の解析に失敗しました: ${err.message}`);
  }

  if (!values.judge) {
    fail('seed には --judge <file> が必要です');
  }
  if (!values.finalists) {
    fail('seed には --finalists <No,No,...> が必要です');
  }

  const judgeData = readJsonFile(values.judge);
  if (!judgeData || typeof judgeData !== 'object' || Array.isArray(judgeData)) {
    fail(`--judge のJSONの形式が不正です（オブジェクトを期待）: ${values.judge}`);
  }

  // --current: 未指定 / ファイル不存在 / 中身が null のいずれも「空のDB」として扱う
  let current = {};
  if (values.current) {
    const currentData = readJsonFile(values.current, { allowMissing: true });
    if (currentData && typeof currentData === 'object' && !Array.isArray(currentData)) {
      current = currentData;
    }
  }

  const finalistNos = parseFinalistsArg(values.finalists);
  const finalistSet = new Set(finalistNos);

  // judge-app データに実在するエントリーNoの集合（部門の対応可否に関わらず）
  const judgeEntries = Object.values(judgeData).filter(
    (entry) => entry && typeof entry === 'object' && typeof entry.no === 'number'
  );
  const allJudgeNos = new Set(judgeEntries.map((entry) => entry.no));

  const missingFinalistNos = finalistNos.filter((no) => !allJudgeNos.has(no));
  if (missingFinalistNos.length > 0) {
    fail(
      `--finalists に審査アプリのデータに存在しないエントリーNoが含まれています: ${missingFinalistNos
        .sort((a, b) => a - b)
        .join(', ')}`
    );
  }

  if (finalistNos.length !== REQUIRED_FINALIST_COUNT) {
    logWarn(
      `--finalists の件数が${REQUIRED_FINALIST_COUNT}件ではありません（実際: ${finalistNos.length}件）`
    );
  }

  const patch = {};
  const unmappedNos = [];
  const droppedFinalistNos = [];

  for (const entry of judgeEntries) {
    const { no, name, department } = entry;
    const section = SECTION_LABEL_TO_CODE[department];
    if (!section) {
      unmappedNos.push(no);
      continue;
    }

    const id = teamIdFromNo(no);
    const isFinalist = finalistSet.has(no);
    const existing = current[id];

    if (!existing || typeof existing !== 'object') {
      // 新規チーム: 全項目を出力する
      patch[`${id}/entryNo`] = no;
      patch[`${id}/title`] = name;
      patch[`${id}/section`] = section;
      patch[`${id}/finalist`] = isFinalist;
      patch[`${id}/participating`] = isFinalist;
      patch[`${id}/videoUrl`] = '';
      continue;
    }

    // 既存チーム: finalist と、本戦の場合の participating: true だけを出力する
    const wasFinalist = existing.finalist === true;
    if (wasFinalist && !isFinalist) {
      // 本戦から外れた: 非表示に戻す
      patch[`${id}/finalist`] = false;
      patch[`${id}/participating`] = false;
      droppedFinalistNos.push(no);
    } else {
      patch[`${id}/finalist`] = isFinalist;
      if (isFinalist) {
        patch[`${id}/participating`] = true;
      }
    }
  }

  if (unmappedNos.length > 0) {
    logWarn(
      `対応しない部門のため登録しませんでした: No ${unmappedNos
        .sort((a, b) => a - b)
        .join(', ')}`
    );
  }
  if (droppedFinalistNos.length > 0) {
    logInfo(
      `本戦から外れたため非表示に戻しました: No ${droppedFinalistNos
        .sort((a, b) => a - b)
        .join(', ')}`
    );
  }

  process.stdout.write(`${JSON.stringify(patch, null, 2)}\n`);
}

function notImplemented(subcommand) {
  fail(
    `"${subcommand}" サブコマンドは未実装です（タスク2.2で実装予定です）。今回は "seed" のみ利用できます。`
  );
}

function usage() {
  return '使い方: node scripts/team-patch.mjs <seed|videos|rename> [options]';
}

function main() {
  const [subcommand, ...rest] = process.argv.slice(2);

  switch (subcommand) {
    case 'seed':
      runSeed(rest);
      break;
    case 'videos':
    case 'rename':
      notImplemented(subcommand);
      break;
    case undefined:
      fail(`サブコマンドを指定してください。${usage()}`);
      break;
    default:
      fail(`不明なサブコマンドです: "${subcommand}"。${usage()}`);
  }
}

main();
