# MMD → VRM Converter

このディレクトリだけで動作する簡易Webアプリです。PMDまたはPMXと参照テクスチャ一式をドロップすると、ブラウザ内でVRM（GLB）を生成します。

```sh
npm install
npm run dev
```

対応範囲の要点:

- フォルダ、複数ファイル、ZIPからPMD / PMXと資材を読み込み
- PNG / JPG / WebPを選択してテクスチャを変換・リサイズ（元サイズ以下）
- GIF / APNGは1コマ目だけをPNGとして埋め込み
- PMD / PMXの頂点・材質・ボーン・頂点／グループモーフをVRMへ変換
- PMDの材質テクスチャとスフィアテクスチャ（`材質*スフィア.sph/.spa`）、toon、モーフ、剛体を共通VRM形式へ変換
- MToon 1.0（デフォルト）または標準PBR（Lit）材質、LookAt、VRM expressions、剛体・ジョイント由来のSpringBoneを生成
- MMDLoaderに合わせて剛体タイプとMMDジョイントの接続を解釈し、type 0だけを固定コライダー、type 1/2をSpringBoneへ変換
- VRMの球／カプセルにないMMDボックス剛体は複数のカプセルへ近似
- 生成したGLBをthree-vrmで再読込できた場合だけダウンロードを有効化
- 読み込んだMMDと生成したVRMを左右のプレビューで比較
- VRMプレビューの表示材質をMToon / MToon Unlit / MMDToon / PBRから切り替え

標準PBR（Lit）を選択した場合、MMDのトゥーン／スフィア（matcap）テクスチャは使用しません。MMDのspecular／shininessはLitのspecular／roughnessへ変換します。MToonを選択した場合、標準トゥーンとカスタムの1次元トゥーンランプはMToonの影色へ変換し、MMDの加算スフィアだけをMToon matcapへ近似します。乗算スフィアはMToonに同等の合成がないため省略します。ベースカラーに指定されたテクスチャが見つからない場合はエラーになります。

比較プレビューでは、MMDのMMDToonMaterialを生成VRM側のメッシュにも一時的に適用します。これにより左右で同じthree.jsのライト、トーンマップ、トゥーンランプ、スフィア合成を使って比較できます。これはプレビュー専用で、ダウンロードされるVRMの材質は選択したMToonまたはLitのままです。MToon 1.0はPBRと協調する別のトゥーン仕様で、MMDの乗算スフィアや画像ランプを標準VRMだけで完全に表現するものではありません。外部ビューアでもMMDと同じ見た目を保証するには、MMD互換シェーダーを独自拡張として実装するか、材質をベイクしたテクスチャを出力する必要があります。

プレビューのMToonは、MToon出力ならVRMLoaderPluginが生成した通常のMToonMaterialをそのまま表示します。Lit出力を選んだ場合は、ベースカラーとテクスチャを通常のMToonMaterialへ一時変換して表示します。MToon Unlitは、three-vrmのMToonにUnlit切替がないため、VRMのベースカラーと透明設定を使ったthree.jsの無照明表示です。MMDToonはPMD / PMX側のMMDToonMaterialをVRMメッシュへ一時的に割り当て、PBRはVRMのベースカラー、法線、emissive、roughness、metalnessを標準のMeshStandardMaterialへ変換して表示します。

MToonでMMDの質感へ寄せる場合は、次の順で近似します。まずPMD / PMXのdiffuse / ambientをglTFのlinear色へ変換し、ベーステクスチャはsRGBとして扱います。次にトゥーンランプの暗部代表色をMToonのshadeColorへ移し、ベーステクスチャもshadeMultiplyTextureとして使って、テクスチャの色を保ったまま暗部を作ります。shadingToonyFactorとshadingShiftFactorで境界を調整します。MMDの加算スフィアはMToon matcapへ近似できますが、乗算スフィアは同じ合成演算がないため、ベーステクスチャへベイクするかMMD互換の独自シェーダーを使う必要があります。MMDの画像ランプをライト方向に応じてそのままサンプリングすることも、標準MToonのパラメータだけではできません。

QDEF、PMD / PMXのボーン／材質／UV／インパルスモーフの完全再現、MMD物理の制限値の完全再現には対応していません。変換時の近似や省略は画面の警告に表示します。

変換方針の照合先は、[Three.js MMDLoader](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/loaders/MMDLoader.js)、[MMD Tools](https://github.com/MMD-Blender/blender_mmd_tools)、[modelconv](https://github.com/binzume/modelconv)、[VRM to MMD Converter](https://nicodan-mmd.github.io/vrm2pmx-md/)、[VRMC_springBone 1.0](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_springBone-1.0/README.md)、[VRMC_materials_mtoon 1.0](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_materials_mtoon-1.0/README.md)です。MMD ToolsのPMXインポータが保持しているsphere textureの乗算／加算モードと、modelconvのMMD→VRM向け`vrmconfig` / `forceUnlit` / `autotpose`設定も変換方針の確認に利用しています。
