import {
  ApiOutlined,
  DeleteOutlined,
  DisconnectOutlined,
  FolderOpenOutlined,
  KeyOutlined,
  PlayCircleOutlined,
  SaveOutlined
} from "@ant-design/icons";
import { Button, Divider, Form, Input, InputNumber, List, Popconfirm, Radio, Space, Tag, Typography, message } from "antd";
import { useMemo } from "react";
import { useConnectionStore } from "../../store/connections";
import type { ServerConfig } from "../../types/protocol";

interface ConnectionPanelProps {
  status: string;
  onConnect: (config: ServerConfig) => void;
  onDisconnect: () => void;
}

export function ConnectionPanel({ status, onConnect, onDisconnect }: ConnectionPanelProps) {
  const [form] = Form.useForm<ServerConfig>();
  const authType = Form.useWatch("authType", form);
  const { profiles, upsertProfile, removeProfile } = useConnectionStore();
  const canSelectPrivateKey = Boolean(window.lshellDesktop?.selectPrivateKey);
  const groupedProfiles = useMemo(
    () =>
      [...profiles].sort((a, b) => {
        const groupCompare = (a.group || "").localeCompare(b.group || "");
        return groupCompare || a.name.localeCompare(b.name);
      }),
    [profiles]
  );

  const handleConnect = async () => {
    const values = await form.validateFields();
    if (values.authType === "password" && !values.password) {
      message.warning("请填写 SSH 密码");
      return;
    }
    if (values.authType === "privateKey" && !values.privateKey && !values.privateKeyPath) {
      message.warning("请填写私钥内容或私钥路径");
      return;
    }
    onConnect({ ...values, port: Number(values.port || 22) });
  };

  const handleSelectPrivateKey = async () => {
    try {
      const filePath = await window.lshellDesktop?.selectPrivateKey();
      if (filePath) {
        form.setFieldValue("privateKeyPath", filePath);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : "选择私钥文件失败");
    }
  };

  const handleSaveProfile = async () => {
    const values = form.getFieldsValue();
    if (!values.name || !values.host || !values.username) {
      message.warning("连接名称、主机和用户名不能为空");
      return;
    }
    upsertProfile({ ...values, port: Number(values.port || 22), authType: values.authType || "password" });
    message.success("连接资料已保存");
  };

  return (
    <aside className="connection-panel">
      <div className="connection-panel-heading">
        <div>
          <Typography.Text strong>SSH 连接</Typography.Text>
          <Typography.Text className="sidebar-section-caption">服务器与认证信息</Typography.Text>
        </div>
        <Tag color={status === "connected" ? "success" : status === "connecting" ? "processing" : "default"}>
          {status}
        </Tag>
      </div>

      <Form
        form={form}
        layout="vertical"
        initialValues={{
          authType: "password",
          port: 22
        }}
        className="connection-form"
      >
        <Form.Item name="id" hidden>
          <Input />
        </Form.Item>
        <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入连接名称" }]}>
          <Input prefix={<ApiOutlined />} placeholder="prod-web-01" />
        </Form.Item>
        <Form.Item name="host" label="主机" rules={[{ required: true, message: "请输入主机地址" }]}>
          <Input placeholder="192.168.1.20" />
        </Form.Item>
        <div className="connection-row">
          <Form.Item name="port" label="端口" rules={[{ required: true, message: "请输入端口" }]}>
            <InputNumber min={1} max={65535} />
          </Form.Item>
          <Form.Item name="username" label="用户" rules={[{ required: true, message: "请输入用户名" }]}>
            <Input placeholder="root" />
          </Form.Item>
        </div>
        <Form.Item name="authType" label="认证">
          <Radio.Group optionType="button" buttonStyle="solid">
            <Radio.Button value="password">密码</Radio.Button>
            <Radio.Button value="privateKey">密钥</Radio.Button>
          </Radio.Group>
        </Form.Item>
        {authType !== "privateKey" ? (
          <Form.Item name="password" label="密码">
            <Input.Password placeholder="SSH password" />
          </Form.Item>
        ) : (
          <>
            <Form.Item name="privateKey" label="私钥">
              <Input.TextArea rows={5} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
            </Form.Item>
            <Form.Item label="私钥路径">
              <Space.Compact block>
                <Form.Item name="privateKeyPath" noStyle>
                  <Input prefix={<KeyOutlined />} placeholder="/Users/me/.ssh/id_rsa" />
                </Form.Item>
                {canSelectPrivateKey ? (
                  <Button
                    icon={<FolderOpenOutlined />}
                    aria-label="选择私钥文件"
                    title="选择私钥文件"
                    onClick={handleSelectPrivateKey}
                  />
                ) : null}
              </Space.Compact>
            </Form.Item>
            <Form.Item name="privateKeyPassphrase" label="Passphrase">
              <Input.Password />
            </Form.Item>
          </>
        )}
        <Form.Item name="group" label="分组">
          <Input placeholder="production" />
        </Form.Item>
      </Form>

      <Space.Compact className="connection-actions">
        <Button type="primary" icon={<PlayCircleOutlined />} loading={status === "connecting"} onClick={handleConnect}>
          连接
        </Button>
        <Button icon={<DisconnectOutlined />} disabled={status !== "connected"} onClick={onDisconnect}>
          断开
        </Button>
        <Button icon={<SaveOutlined />} onClick={handleSaveProfile}>
          保存
        </Button>
      </Space.Compact>

      <Divider />

      <div className="profile-list-header">
        <Typography.Text>连接资料</Typography.Text>
        <Typography.Text type="secondary">{groupedProfiles.length}</Typography.Text>
      </div>
      <List
        className="profile-list"
        dataSource={groupedProfiles}
        locale={{ emptyText: "暂无保存资料" }}
        renderItem={(profile) => (
          <List.Item
            onClick={() => form.setFieldsValue({ ...profile, password: undefined, privateKey: undefined })}
            actions={[
              <Popconfirm
                key="remove"
                title="删除连接资料"
                okText="删除"
                cancelText="取消"
                onConfirm={(event) => {
                  event?.stopPropagation();
                  removeProfile(profile.id!);
                }}
              >
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={(event) => event.stopPropagation()}
                />
              </Popconfirm>
            ]}
          >
            <List.Item.Meta
              title={<span>{profile.name}</span>}
              description={`${profile.username}@${profile.host}:${profile.port}`}
            />
            {profile.group ? <Tag>{profile.group}</Tag> : null}
          </List.Item>
        )}
      />
    </aside>
  );
}
