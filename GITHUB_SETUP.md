# 推送到 GitHub / Push to GitHub

## 中文

### 1. 在 GitHub 上创建新仓库

1. 登录 [GitHub](https://github.com)
2. 点击右上角 **+** → **New repository**
3. 填写：
   - **Repository name**：例如 `inventory-intelligence` 或 `Inventory-Intelligence`
   - **Description**：可选，如「智能库存管理系统 Group Project」
   - 选择 **Public**
   - **不要**勾选 "Add a README" / "Add .gitignore"（本地已有）
4. 点击 **Create repository**

### 2. 把本地项目推上去

在终端执行（把 `YOUR_USERNAME` 和 `YOUR_REPO` 换成你的 GitHub 用户名和仓库名）：

```bash
cd "/Users/qichengfu/Desktop/Inventory Intelligence"

# 添加远程仓库
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git

# 推送到 GitHub（首次）
git push -u origin main
```

如果 GitHub 显示的是 `master` 分支，则用：

```bash
git push -u origin main
```

若本地是 `master` 而远程要 `main`，可先改本地分支名再推送：

```bash
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### 3. 组员协作

- **邀请成员**：仓库页 → **Settings** → **Collaborators** → **Add people**，输入组员 GitHub 用户名或邮箱
- **组员克隆**：
  ```bash
  git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
  cd YOUR_REPO
  cd frontend && npm install && npm run dev
  ```
- **日常提交与推送**：
  ```bash
  git add .
  git commit -m "描述你的修改"
  git push
  ```

### 4. 重要提醒

- 不要提交 `frontend/.env.local`（里含 Supabase 密钥），已写在 `.gitignore`
- 组员需要在本地自己建 `frontend/.env.local` 并填入各自的 Supabase URL 和 Key（或共用同一份配置）

---

## English

### 1. Create a new repository on GitHub

1. Log in to [GitHub](https://github.com)
2. Click **+** → **New repository**
3. Set:
   - **Repository name**: e.g. `inventory-intelligence` or `Inventory-Intelligence`
   - **Description**: optional, e.g. "Intelligent inventory management system - Group Project"
   - Choose **Public**
   - **Do not** check "Add a README" or "Add .gitignore" (you already have them locally)
4. Click **Create repository**

### 2. Push your local project

In the terminal (replace `YOUR_USERNAME` and `YOUR_REPO` with your GitHub username and repo name):

```bash
cd "/Users/qichengfu/Desktop/Inventory Intelligence"

# Add remote
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git

# Push (first time)
git push -u origin main
```

If your default branch is `master`:

```bash
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### 3. Group collaboration

- **Invite collaborators**: Repo → **Settings** → **Collaborators** → **Add people** (GitHub username or email)
- **Teammates clone**:
  ```bash
  git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
  cd YOUR_REPO
  cd frontend && npm install && npm run dev
  ```
- **Daily workflow**:
  ```bash
  git add .
  git commit -m "Describe your changes"
  git push
  ```

### 4. Notes

- Do not commit `frontend/.env.local` (Supabase keys); it is in `.gitignore`
- Teammates should create their own `frontend/.env.local` with Supabase URL and anon key (or share the same config securely)
