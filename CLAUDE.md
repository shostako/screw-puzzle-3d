# screw-puzzle-3d

ねじ外しパズル 2D 版（shostako/screw-puzzle）を発展させた3D版。仕様は `docs/SPEC.md`。

## CI と配信

- `.github/workflows/` の YAML は変えない。Claude の GitHub App には workflows 権限が無く、ワークフローのファイルを含む push は GitHub に拒否される。
- PR の検査は `scripts/ci.sh`（package.json に test があれば `npm test`、続けて `scripts/build.sh`）。検査を増やすときはこちらを書き換える。
- 公開するページは `scripts/build.sh` が `dist/` に作る。master に入ると GitHub Pages（https://shostako.github.io/screw-puzzle-3d/ ）へ配信される。

## master の保護

- master へは PR でしか入らない。CI の `ci` チェックが成功しないとマージできない。force push とブランチの削除はできない。
- マージ後のブランチは GitHub が自動で消す。
