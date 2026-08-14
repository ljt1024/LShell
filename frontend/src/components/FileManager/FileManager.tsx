import {
  ArrowUpOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FileTextOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  ReloadOutlined,
  UploadOutlined
} from "@ant-design/icons";
import {
  Breadcrumb,
  Button,
  Drawer,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import type { FileInfo } from "../../types/protocol";

type NameAction = { type: "mkdir" } | { type: "rename"; file: FileInfo };

interface FileManagerProps {
  connected: boolean;
  files: FileInfo[];
  currentPath: string;
  activeFilePath?: string;
  fileContent: string;
  dirty: boolean;
  onList: (path: string) => void;
  onRead: (path: string) => void;
  onSave: () => void;
  onCloseEditor: () => void;
  onContentChange: (content: string) => void;
  onMkdir: (path: string) => void;
  onRemove: (path: string) => void;
  onRename: (oldPath: string, newPath: string) => void;
  onUpload: (file: File) => Promise<void>;
  onDownload: (path: string) => void;
}

export function FileManager({
  connected,
  files,
  currentPath,
  activeFilePath,
  fileContent,
  dirty,
  onList,
  onRead,
  onSave,
  onCloseEditor,
  onContentChange,
  onMkdir,
  onRemove,
  onRename,
  onUpload,
  onDownload
}: FileManagerProps) {
  const [nameAction, setNameAction] = useState<NameAction>();
  const [nameInput, setNameInput] = useState("");

  const columns: ColumnsType<FileInfo> = [
    {
      title: "名称",
      dataIndex: "name",
      ellipsis: true,
      render: (_, file) => (
        <Space>
          {file.type === "directory" ? <FolderOutlined className="file-folder" /> : <FileTextOutlined />}
          <span>{file.name}</span>
        </Space>
      )
    },
    {
      title: "类型",
      dataIndex: "type",
      width: 96,
      render: (type: FileInfo["type"]) => <Tag color={type === "directory" ? "green" : "default"}>{type}</Tag>
    },
    {
      title: "大小",
      dataIndex: "size",
      width: 108,
      render: (size: number, file) => (file.type === "directory" ? "-" : formatBytes(size))
    },
    {
      title: "权限",
      dataIndex: "permissions",
      width: 88
    },
    {
      title: "修改时间",
      dataIndex: "modifyTime",
      width: 178,
      render: (modifyTime: number) => new Date(modifyTime).toLocaleString()
    },
    {
      title: "",
      key: "actions",
      width: 136,
      render: (_, file) => (
        <Space size={2}>
          {file.type === "directory" ? (
            <Tooltip title="打开">
              <Button size="small" type="text" icon={<FolderOpenOutlined />} onClick={() => onList(file.path)} />
            </Tooltip>
          ) : (
            <>
              <Tooltip title="编辑">
                <Button size="small" type="text" icon={<EditOutlined />} onClick={() => onRead(file.path)} />
              </Tooltip>
              <Tooltip title="下载">
                <Button size="small" type="text" icon={<DownloadOutlined />} onClick={() => onDownload(file.path)} />
              </Tooltip>
            </>
          )}
          <Tooltip title="重命名">
            <Button size="small" type="text" onClick={() => openRename(file)} icon={<EditOutlined />} />
          </Tooltip>
          <Popconfirm title="删除远程项目" okText="删除" cancelText="取消" onConfirm={() => onRemove(file.path)}>
            <Button size="small" type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      )
    }
  ];

  const breadcrumbItems = createBreadcrumb(currentPath).map((item) => ({
    title: (
      <button type="button" className="path-button" onClick={() => onList(item.path)}>
        {item.label}
      </button>
    )
  }));

  const openMkdir = () => {
    setNameInput("");
    setNameAction({ type: "mkdir" });
  };

  const openRename = (file: FileInfo) => {
    setNameInput(file.name);
    setNameAction({ type: "rename", file });
  };

  const closeNameModal = () => {
    setNameAction(undefined);
    setNameInput("");
  };

  const submitNameAction = () => {
    if (!nameAction) {
      return;
    }
    const name = nameInput.trim();
    const validationError = validateRemoteName(name);
    if (validationError) {
      message.warning(validationError);
      return;
    }
    if (nameAction.type === "mkdir") {
      onMkdir(joinPath(currentPath, name));
    } else if (name !== nameAction.file.name) {
      onRename(nameAction.file.path, joinPath(dirname(nameAction.file.path), name));
    }
    closeNameModal();
  };

  return (
    <section className="file-panel">
      <div className="section-bar">
        <Space className="file-location" size={10}>
          <FolderOpenOutlined />
          <div className="file-location-copy">
            <Typography.Text strong>文件浏览器</Typography.Text>
            <Breadcrumb items={breadcrumbItems} />
          </div>
        </Space>
        <Space.Compact className="file-toolbar">
          <Tooltip title="上级目录">
            <Button disabled={!connected || currentPath === "/"} icon={<ArrowUpOutlined />} onClick={() => onList(dirname(currentPath))} />
          </Tooltip>
          <Tooltip title="刷新">
            <Button disabled={!connected} icon={<ReloadOutlined />} onClick={() => onList(currentPath)} />
          </Tooltip>
          <Tooltip title="新建目录">
            <Button disabled={!connected} icon={<FolderAddOutlined />} onClick={openMkdir} />
          </Tooltip>
          <Upload
            showUploadList={false}
            beforeUpload={(file) => {
              void onUpload(file)
                .then(() => message.success(`${file.name} 已上传`))
                .catch((error) => message.error(error instanceof Error ? error.message : "上传失败"));
              return Upload.LIST_IGNORE;
            }}
            disabled={!connected}
          >
            <Tooltip title="上传文件">
              <Button disabled={!connected} icon={<UploadOutlined />} aria-label="上传文件" />
            </Tooltip>
          </Upload>
        </Space.Compact>
      </div>
      <Table<FileInfo>
        rowKey="path"
        size="small"
        columns={columns}
        dataSource={files}
        pagination={false}
        scroll={{ x: 860 }}
        locale={{ emptyText: connected ? "目录为空" : "未连接" }}
        onRow={(file) => ({
          onDoubleClick: () => {
            if (file.type === "directory") {
              onList(file.path);
            } else {
              onRead(file.path);
            }
          }
        })}
      />

      <Drawer
        title={
          <Space>
            <FileTextOutlined />
            <span>{activeFilePath}</span>
            {dirty ? <Tag color="warning">modified</Tag> : null}
          </Space>
        }
        open={Boolean(activeFilePath)}
        width="min(760px, 100vw)"
        onClose={onCloseEditor}
        extra={
          <Button type="primary" icon={<EditOutlined />} disabled={!dirty} onClick={onSave}>
            保存
          </Button>
        }
      >
        <Input.TextArea
          className="file-editor"
          value={fileContent}
          onChange={(event) => onContentChange(event.target.value)}
          spellCheck={false}
        />
      </Drawer>

      <Modal
        title={nameAction?.type === "rename" ? "重命名远程项目" : "新建目录"}
        open={Boolean(nameAction)}
        okText={nameAction?.type === "rename" ? "保存" : "创建"}
        cancelText="取消"
        onOk={submitNameAction}
        onCancel={closeNameModal}
        okButtonProps={{ disabled: !nameInput.trim() }}
        destroyOnClose
      >
        <Input
          autoFocus
          value={nameInput}
          placeholder={nameAction?.type === "rename" ? "输入新名称" : "输入目录名称"}
          onChange={(event) => setNameInput(event.target.value)}
          onPressEnter={submitNameAction}
        />
        <Typography.Text type="secondary">名称不能包含斜杠，也不能使用 . 或 ..</Typography.Text>
      </Modal>
    </section>
  );
}

function validateRemoteName(name: string): string | undefined {
  if (!name) {
    return "名称不能为空";
  }
  if (name === "." || name === "..") {
    return "名称不能使用 . 或 ..";
  }
  if (name.includes("/") || name.includes("\\")) {
    return "名称不能包含斜杠";
  }
  if (name.includes("\0")) {
    return "名称包含无效字符";
  }
  return undefined;
}

function createBreadcrumb(path: string) {
  const parts = path.split("/").filter(Boolean);
  const items = [{ label: "/", path: "/" }];
  parts.forEach((part, index) => {
    items.push({ label: part, path: `/${parts.slice(0, index + 1).join("/")}` });
  });
  return items;
}

function dirname(remotePath: string): string {
  const parts = remotePath.split("/").filter(Boolean);
  if (parts.length <= 1) {
    return "/";
  }
  return `/${parts.slice(0, -1).join("/")}`;
}

function joinPath(base: string, name: string): string {
  const trimmedBase = base === "/" ? "" : base.replace(/\/$/, "");
  return `${trimmedBase}/${name.replace(/^\//, "")}`;
}

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = size / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
}
