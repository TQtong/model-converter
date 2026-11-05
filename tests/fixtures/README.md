# 样例与许可

- 浏览器测试中的三角形、立方体、UV 红色贴图、蒙皮动画、点云和高斯均由本项目自行构造，按 CC0 1.0 提供，允许复制与再分发。
- CAD/FreeCAD 测试使用锁定的 `occt-import-js@0.0.23` npm 分发包内的 `test/testfiles/cube-10x10mm`、`cax-if-brep`、`cube-fcstd` 样例。源项目与许可：https://github.com/kovacsv/occt-import-js ，LGPL-2.1。样例保留在依赖包中，未复制进站点发布目录。
- 输出样例通过对应读取器回读，同时检查几何规模、包围盒、蒙皮/动画、UV/贴图和双精度坐标；重建测试用已知球面检查径向误差。
