# Inventory Intelligence - 功能文档 / Features Documentation

## 目录 / Table of Contents

- [系统概述 / System Overview](#系统概述--system-overview)
- [核心功能 / Core Features](#核心功能--core-features)
- [页面功能详解 / Detailed Page Features](#页面功能详解--detailed-page-features)
- [API 接口 / API Endpoints](#api-接口--api-endpoints)
- [数据模型 / Data Models](#数据模型--data-models)
- [技术栈 / Technology Stack](#技术栈--technology-stack)

---

## 系统概述 / System Overview

**中文：**
Inventory Intelligence 是一个智能库存管理系统，提供数据上传、查询、分析和预测功能。系统支持从 Supabase 数据库读取数据，并提供多语言界面（中文/英文）和深色模式支持。

**English:**
Inventory Intelligence is an intelligent inventory management system that provides data upload, query, analysis, and forecasting capabilities. The system supports reading data from Supabase database and offers multilingual interface (Chinese/English) and dark mode support.

---

## 核心功能 / Core Features

### 1. 数据上传与管理 / Data Upload & Management

**中文：**
- 支持上传 CSV/Excel 格式的库存数据文件
- 自动识别表头（支持中文和英文列名）
- 智能解析数据并自动填充到表格
- 支持批量保存到 Supabase 数据库
- 自动从文件名提取月份信息
- 数据验证和清理（处理空值、"-" 等特殊字符）

**English:**
- Upload inventory data files in CSV/Excel formats
- Auto-detect headers (supports both Chinese and English column names)
- Intelligent data parsing and auto-populate tables
- Batch save to Supabase database
- Auto-extract month information from filenames
- Data validation and cleaning (handles empty values, "-" characters, etc.)

### 2. 库存查询 / Inventory Search

**中文：**
- 支持多条件搜索（SKU、型号、批号、类别、状态、月份、数量范围）
- 语法查询：`sku:FWD100 category:Electronics min:0 max:100`
- 实时筛选和结果高亮
- 显示库存状态（正常/缺货预警/已售罄）

**English:**
- Multi-criteria search (SKU, model, batch, category, status, month, quantity range)
- Syntax queries: `sku:FWD100 category:Electronics min:0 max:100`
- Real-time filtering and result highlighting
- Display inventory status (Normal/Low Stock/Out of Stock)

### 3. 需求预测与补货建议 / Demand Forecasting & Reorder Suggestions

**中文：**
- 多模型预测（NAIVE, SNAIVE, SMA, SES, HOLT, HW）
- 按月级数据预测未来需求
- 自动计算建议补货量
- 风险等级评估（低/中/高）
- 预计缺货月份预测
- 支持普通客户和大客户不同的安全库存

**English:**
- Multi-model forecasting (NAIVE, SNAIVE, SMA, SES, HOLT, HW)
- Monthly demand forecasting
- Automatic reorder quantity calculation
- Risk level assessment (Low/Medium/High)
- Projected stockout month prediction
- Support different safety stock for regular and key account customers

### 4. 数据可视化 / Data Visualization

**中文：**
- 交互式折线图显示历史需求和预测
- 支持多模型对比显示
- 可切换显示范围（6个月/12个月/18个月/24个月/全部）
- 点击图例可隐藏/显示特定模型

**English:**
- Interactive line charts for historical demand and forecasts
- Multi-model comparison display
- Switchable display ranges (6M/12M/18M/24M/All)
- Click legend to show/hide specific models

---

## 页面功能详解 / Detailed Page Features

### 首页 / Home Page (`/`)

**中文：**
- **KPI 仪表板**：显示总库存 SKU 数、缺货预警、本月出库数、平均周转天数
- **操作入口**：
  - 上传库存数据
  - 库存数据库
  - 库存查询（常用）
  - 入库/出库记录
  - 库存报表导出
- **智能分析入口**：
  - 预测 & 补货（核心）
  - 预警 & 风险（推荐）
  - 周转 & 滞销
  - ABC & 分层策略
  - 异常 & 数据质量
  - 表现 & 准确度
- **AI 对话界面**：支持自然语言查询（模拟）
- **最近动态**：显示系统活动记录
- **趋势图表**：本周出库趋势可视化

**English:**
- **KPI Dashboard**: Displays total SKUs, low stock alerts, monthly outbound, average turnover days
- **Operation Entries**:
  - Upload Inventory Data
  - Inventory Database
  - Inventory Lookup (Popular)
  - Stock Movements
  - Inventory Reports Export
- **Intelligent Analytics Entries**:
  - Forecast & Replenish (Core)
  - Alerts & Risk (Hot)
  - Turnover & Slow-Moving
  - ABC & Segmentation
  - Anomaly & Data Quality
  - Performance & Accuracy
- **AI Chat Interface**: Supports natural language queries (mock)
- **Recent Activity**: Displays system activity records
- **Trend Charts**: Weekly outbound trend visualization

### 库存管理 / Inventory Management (`/inventory`)

**中文：**
- **文件上传**：
  - 支持 XLS/CSV 格式
  - 自动识别列名（型号/Model/SKU、批号/Batch、月份/Time 等）
  - 自动解析并填充表格
  - 支持从文件名提取月份（如 `2025-01-cleaned.csv` → `2025-01`）
- **数据筛选**：
  - 按名称或编号搜索
  - 按类别筛选
  - 按库存状态筛选（正常/缺货预警/已售罄）
- **数据保存**：
  - 保存到 Supabase 数据库
  - 自动清理数据格式（处理 "-"、空值等）
  - 批量插入支持
- **安全库存管理**：
  - 上传安全库存配置
  - 支持普通客户和大客户不同配置
- **类别管理**：
  - 上传 Appendix 文件自动识别类别
  - 类别持久化存储

**English:**
- **File Upload**:
  - Supports XLS/CSV formats
  - Auto-detect column names (Model/SKU, Batch, Time, etc.)
  - Auto-parse and populate tables
  - Extract month from filename (e.g., `2025-01-cleaned.csv` → `2025-01`)
- **Data Filtering**:
  - Search by name or ID
  - Filter by category
  - Filter by inventory status (Normal/Low Stock/Out of Stock)
- **Data Saving**:
  - Save to Supabase database
  - Auto-clean data format (handles "-", empty values, etc.)
  - Batch insert support
- **Safety Stock Management**:
  - Upload safety stock configuration
  - Support different configs for regular and key account customers
- **Category Management**:
  - Upload Appendix file to auto-detect categories
  - Category persistence storage

### 库存查询 / Inventory Search (`/search`)

**中文：**
- **高级搜索语法**：
  - `sku:FWD100` - 按 SKU 搜索
  - `category:Electronics` - 按类别搜索
  - `status:Low` - 按状态搜索
  - `batch:24100761` - 按批号搜索
  - `min:0 max:100` - 按数量范围搜索
  - `month:2025-01` - 按月份搜索
  - 支持组合查询
- **结果展示**：
  - 高亮匹配关键词
  - 显示库存汇总（总数、低库存数、缺货数、数量合计）
  - 分页显示（每页最多 300 条）

**English:**
- **Advanced Search Syntax**:
  - `sku:FWD100` - Search by SKU
  - `category:Electronics` - Search by category
  - `status:Low` - Search by status
  - `batch:24100761` - Search by batch
  - `min:0 max:100` - Search by quantity range
  - `month:2025-01` - Search by month
  - Supports combined queries
- **Result Display**:
  - Highlight matching keywords
  - Display inventory summary (total, low stock count, out of stock count, quantity sum)
  - Paginated display (max 300 items per page)

### 数据概览 / Dataset Overview (`/dataset`)

**中文：**
- **数据集列表**：
  - 显示所有已上传的数据集
  - 显示文件名、上传时间、行数、大小
  - 按月份分组显示
- **数据预览**：
  - 点击"查看详情"查看完整数据
  - 表格形式展示
  - 支持搜索和筛选

**English:**
- **Dataset List**:
  - Display all uploaded datasets
  - Show filename, upload date, row count, size
  - Group by month
- **Data Preview**:
  - Click "View Data" to see full data
  - Display in table format
  - Support search and filtering

### 预测与补货 / Forecast & Replenish (`/analytics/forecast`)

**中文：**
- **SKU 选择**：
  - 下拉菜单选择 SKU
  - 自动从数据库加载所有可用 SKU
  - 支持本地数据和数据库数据合并
- **客户类型选择**：
  - 普通客户
  - 大客户
  - 不同客户类型对应不同的安全库存
- **预测模型选择**：
  - NAIVE（朴素预测）
  - SNAIVE（季节性朴素）
  - SMA（简单移动平均）
  - SES（单指数平滑）
  - HOLT（霍尔特方法）
  - HW（霍尔特-温特斯）
- **预测参数**：
  - 预测窗口：6个月/12个月/18个月/24个月
  - 交期：1个月/2个月/3个月
- **KPI 显示**：
  - 当前库存：从数据库最新月份读取
  - 安全库存：从数据库 `safety_stock` 列读取
  - 风险评估：基于当前库存与安全库存对比
  - 建议补货量：安全库存 + 交期内预测需求 - 当前库存
- **图表功能**：
  - 显示历史需求和未来预测
  - 多模型对比
  - 可切换显示范围
  - 点击图例隐藏/显示模型
- **数据聚合**：
  - 同一 SKU 同一月份不同 batch 的 `month_sales` 自动累加
  - 按月份汇总显示

**English:**
- **SKU Selection**:
  - Dropdown menu to select SKU
  - Auto-load all available SKUs from database
  - Support merging local and database data
- **Customer Type Selection**:
  - Regular Customer
  - Key Account
  - Different customer types correspond to different safety stock
- **Forecast Model Selection**:
  - NAIVE (Naive Forecast)
  - SNAIVE (Seasonal Naive)
  - SMA (Simple Moving Average)
  - SES (Single Exponential Smoothing)
  - HOLT (Holt's Method)
  - HW (Holt-Winters)
- **Forecast Parameters**:
  - Forecast Horizon: 6M/12M/18M/24M
  - Lead Time: 1M/2M/3M
- **KPI Display**:
  - Current Stock: Read from database latest month
  - Safety Stock: Read from database `safety_stock` column
  - Risk Assessment: Based on current stock vs safety stock comparison
  - Suggested Reorder: Safety stock + Lead-time demand - Current stock
- **Chart Features**:
  - Display historical demand and future forecasts
  - Multi-model comparison
  - Switchable display ranges
  - Click legend to show/hide models
- **Data Aggregation**:
  - Auto-sum `month_sales` for same SKU and same month with different batches
  - Display aggregated by month

---

## API 接口 / API Endpoints

### `/api/inventory/skus`
**方法：** GET  
**功能：** 获取所有 SKU 列表  
**返回：** `{ skus: string[] }`  
**说明：** 分页查询，支持超过 1000 条数据

### `/api/inventory/demand`
**方法：** GET  
**参数：** `sku` (query parameter)  
**功能：** 获取指定 SKU 的历史需求数据  
**返回：** `{ sku: string, series: Array<{ t: string, y: number }> }`  
**说明：** 自动累加同一月份不同 batch 的销量

### `/api/inventory/currentStock`
**方法：** GET  
**参数：** `sku` (query parameter)  
**功能：** 获取指定 SKU 的当前库存  
**返回：** `{ sku: string, month: string, currentStock: number }`  
**说明：** 返回最新月份的库存数据

### `/api/inventory/safetyStock`
**方法：** GET  
**参数：** `sku` (query parameter)  
**功能：** 获取指定 SKU 的安全库存  
**返回：** `{ sku: string, safetyStock: number }`  
**说明：** 从数据库 `safety_stock` 列读取

### `/api/inventory/upload`
**方法：** POST  
**请求体：** `{ rows: InventoryItem[], fileName: string }`  
**功能：** 批量保存库存数据到数据库  
**返回：** `{ success: boolean, inserted: number, total: number }`  
**说明：** 自动清理数据格式，处理 "-" 和空值

### `/api/inventory/datasets`
**方法：** GET  
**功能：** 获取所有已上传的数据集列表  
**返回：** `{ datasets: Array<{ fileName, uploadDate, rowCount, size, month }> }`  
**说明：** 按月份分组统计

---

## 数据模型 / Data Models

### 数据库表结构 / Database Table Structure

**表名：** `summary` (可通过环境变量 `INVENTORY_TABLE` 配置)

**主要列：**
- `SKU` (text) - 产品型号
- `batch` (bigint) - 批号
- `Time` (text) - 月份，格式：`YYYY-MM`
- `Last_Month_Stock` (float8) - 上月结存
- `month_in` (float8) - 本月入库
- `month_out` (float8) - 本月领用
- `month_sales` (float8) - 本月销售
- `month_end_stock` (float8) - 本月结存
- `Note_value` (float8) - 备注值
- `safety_stock` (float8) - 安全库存
- `Location` (text) - 存放位置
- `month_end_inventory` (float8) - 月末库存
- `inventory_diff` (float8) - 库存差异
- `Remark` (text) - 备注

### 环境变量配置 / Environment Variables

**必需：**
- `SUPABASE_URL` - Supabase 项目 URL
- `SUPABASE_ANON_KEY` - Supabase 匿名密钥

**可选：**
- `INVENTORY_SCHEMA` - 数据库 schema（默认：`public`）
- `INVENTORY_TABLE` - 表名（默认：`summary`）
- `INVENTORY_SKU_COLUMN` - SKU 列名（默认：`SKU`）
- `INVENTORY_TIME_COLUMN` - 时间列名（默认：`Time`）
- `INVENTORY_SALES_COLUMN` - 销量列名（默认：`month_sales`）
- `INVENTORY_STOCK_COLUMN` - 库存列名（默认：`month_end_stock`）

---

## 技术栈 / Technology Stack

**前端：**
- Next.js 14 (App Router)
- React 18
- TypeScript
- Tailwind CSS v4
- Recharts (图表库)
- XLSX (Excel 解析)

**后端：**
- Next.js API Routes
- Supabase (PostgreSQL 数据库)

**功能特性：**
- 多语言支持（中文/英文）
- 深色模式支持
- 响应式设计
- 客户端数据缓存（LocalStorage）

---

## 使用说明 / Usage Instructions

### 启动开发服务器 / Start Development Server

```bash
cd frontend
npm run dev
```

访问：`http://localhost:3000`

### 数据上传流程 / Data Upload Workflow

1. **准备数据文件**：确保文件包含 `SKU`/`Model`/`型号` 列和 `Time`/`月份` 列
2. **上传文件**：在库存管理页面点击"上传库存数据"
3. **检查数据**：确认表格中的数据正确
4. **保存到数据库**：点击"保存到数据库"按钮

### 预测功能使用 / Using Forecast Feature

1. **选择 SKU**：从下拉菜单选择要预测的产品
2. **选择客户类型**：普通或大客户
3. **选择预测模型**：根据数据量选择合适的模型
4. **设置参数**：预测窗口和交期
5. **查看结果**：查看预测图表、建议补货量和风险评估

---

## 注意事项 / Important Notes

**中文：**
- 确保 Supabase 数据库已正确配置 RLS（Row Level Security）策略
- 上传文件时，如果列名不匹配，系统会尝试智能识别
- 同一 SKU 同一月份的数据会自动累加
- 安全库存优先从数据库读取，如果没有则使用本地配置

**English:**
- Ensure Supabase database has proper RLS (Row Level Security) policies configured
- When uploading files, if column names don't match, the system will attempt intelligent recognition
- Data for the same SKU and same month will be automatically aggregated
- Safety stock is prioritized from database, falls back to local config if not available

---

**文档版本 / Document Version:** 1.0  
**最后更新 / Last Updated:** 2026-01-20
