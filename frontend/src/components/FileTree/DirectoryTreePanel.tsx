import { FolderOpenOutlined, FolderOutlined, ReloadOutlined } from "@ant-design/icons";
import { Button, Empty, Spin, Tooltip, Tree, Typography } from "antd";
import type { TreeDataNode, TreeProps } from "antd";
import { useEffect, useMemo, useState } from "react";
import type { FileInfo } from "../../types/protocol";

interface DirectoryTreePanelProps {
  connected: boolean;
  currentPath: string;
  directoryCache: Record<string, FileInfo[]>;
  loadingDirectories: string[];
  onNavigate: (path: string) => void;
  onLoadDirectory: (path: string) => void;
}

export function DirectoryTreePanel({
  connected,
  currentPath,
  directoryCache,
  loadingDirectories,
  onNavigate,
  onLoadDirectory
}: DirectoryTreePanelProps) {
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>(["/"]);

  useEffect(() => {
    if (!connected) {
      setExpandedKeys(["/"]);
      return;
    }

    setExpandedKeys((current) => Array.from(new Set([...current, ...getAncestorPaths(currentPath)])));
  }, [connected, currentPath]);

  useEffect(() => {
    if (connected && !("/" in directoryCache) && !loadingDirectories.includes("/")) {
      onLoadDirectory("/");
    }
  }, [connected, directoryCache, loadingDirectories, onLoadDirectory]);

  const treeData = useMemo<TreeDataNode[]>(
    () => [
      buildDirectoryNode(
        "/",
        "/",
        directoryCache,
        new Set(loadingDirectories),
        new Set(expandedKeys.map(String))
      )
    ],
    [directoryCache, expandedKeys, loadingDirectories]
  );

  const handleExpand: TreeProps["onExpand"] = (keys, info) => {
    setExpandedKeys(keys);
    const path = String(info.node.key);
    if (info.expanded && !(path in directoryCache) && !loadingDirectories.includes(path)) {
      onLoadDirectory(path);
    }
  };

  return (
    <section className="directory-tree-panel">
      <div className="sidebar-section-header">
        <div>
          <Typography.Text strong>远程目录</Typography.Text>
          <Typography.Text className="sidebar-section-caption">SFTP workspace</Typography.Text>
        </div>
        <Tooltip title="刷新当前目录">
          <Button
            type="text"
            size="small"
            icon={<ReloadOutlined />}
            disabled={!connected}
            loading={loadingDirectories.includes(currentPath)}
            onClick={() => onLoadDirectory(currentPath)}
            aria-label="刷新当前目录树"
          />
        </Tooltip>
      </div>

      <div className="directory-tree-scroll">
        {connected ? (
          <Tree
            blockNode
            showLine={{ showLeafIcon: false }}
            treeData={treeData}
            expandedKeys={expandedKeys}
            selectedKeys={[currentPath]}
            onExpand={handleExpand}
            onSelect={(keys) => {
              const path = keys[0];
              if (path) {
                onNavigate(String(path));
              }
            }}
          />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="连接服务器后显示目录" />
        )}
      </div>
    </section>
  );
}

function buildDirectoryNode(
  path: string,
  label: string,
  directoryCache: Record<string, FileInfo[]>,
  loadingDirectories: Set<string>,
  expandedDirectories: Set<string>
): TreeDataNode {
  const loaded = path in directoryCache;
  const directories = (directoryCache[path] ?? []).filter((file) => file.type === "directory");
  const loading = loadingDirectories.has(path);

  return {
    key: path,
    isLeaf: loaded && directories.length === 0,
    title: (
      <span className="directory-node-title">
        <span className="directory-node-main">
          {expandedDirectories.has(path) ? (
            <FolderOpenOutlined className="directory-node-icon" />
          ) : (
            <FolderOutlined className="directory-node-icon" />
          )}
          <span className="directory-node-label">{label}</span>
        </span>
        {loading ? <Spin size="small" /> : null}
      </span>
    ),
    children: loaded
      ? directories.map((directory) =>
          buildDirectoryNode(
            directory.path,
            directory.name,
            directoryCache,
            loadingDirectories,
            expandedDirectories
          )
        )
      : undefined
  };
}

function getAncestorPaths(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  const ancestors = ["/"];
  parts.forEach((_, index) => {
    ancestors.push(`/${parts.slice(0, index + 1).join("/")}`);
  });
  return ancestors;
}
