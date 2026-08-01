# SuperPoE2 开发数据

`SuperPoE2/Local Storage/leveldb/` 是 Electron 应用本地存储的二进制快照，
其中包含 `pob2-saved-builds` localStorage 键下的构筑列表，仅用于项目开发和调试。

快照来源：

```text
%APPDATA%\SuperPoE2\Local Storage\leveldb
```

## Windows 恢复步骤

1. 关闭所有正在运行的 SuperPoE2/Electron 进程。
2. 直接双击：

   ```text
   dev-data\SuperPoE2\restore-windows.cmd
   ```

   也可以在项目根目录执行 PowerShell：

   ```powershell
   powershell -ExecutionPolicy Bypass -File ".\dev-data\SuperPoE2\restore.ps1"
   ```

3. 重新启动桌面应用。

脚本会先把当前 LevelDB 自动备份为
`%APPDATA%\SuperPoE2\Local Storage\leveldb.backup-日期时间`，再恢复项目快照；
如果复制失败，会自动还原恢复前的数据。

## macOS 恢复步骤

1. 关闭所有正在运行的 SuperPoE2 进程。
2. 在项目根目录执行：

   ```bash
   bash "./dev-data/SuperPoE2/restore.sh"
   ```

3. 重新启动桌面应用。

脚本会先把当前 LevelDB 自动备份为
`~/Library/Application Support/SuperPoE2/Local Storage/leveldb.backup-日期时间`，
再恢复项目快照；如果复制失败，会自动还原恢复前的数据。

不要只复制单个 `.ldb` 或 `.log` 文件。必须在应用停止时完整恢复整个 LevelDB 目录。
