# 標準頁面結構模式

## 管理頁面結構

大部分管理頁面遵循以下標準模式（使用 Element Plus 原生元件，本專案尚未有 `Ly*` 系列封裝，如需快速建立常用篩選器請依業務自行包裝）：

```pug
.PageName
  //- -- 上方操作區 --
  .PageName__actions
    //- 篩選表單（原生 ElInput + ElSelect）
    ElInput(
      v-model="searchKey"
      maxlength="200"
      placeholder="請輸入關鍵字"
      clearable
      @input="ApiGetList"
    )
    ElSelect(v-model="companyId" value-on-clear="" clearable @change="ApiGetList")
      ElOption(v-for="item in companyOptions" :key="item.id" :label="item.name" :value="item.id")

    //- 操作按鈕（自行排版）
    .PageName__ctrl
      ElButton(type="primary" @click="ClickCreate") 新增

  //- -- 資料列表 --
  .PageName__table
    ElTable(:data="tableData" v-loading="isLoading")
      ElTableColumn(prop="name" label="名稱")
      ElTableColumn(prop="status" label="狀態")
        template(#default="{ row }")
          ElTag(:type="getStatusType(row.status)") {{ row.statusText }}
      ElTableColumn(label="操作" width="150")
        template(#default="{ row }")
          ElButton(link @click="ClickDetail(row.id)") 詳情
          ElButton(link @click="ClickEdit(row.id)") 編輯

  //- -- 分頁（使用封裝過的 ElPaginationPlus） --
  .PageName__pagination
    ElPaginationPlus(
      v-model:current-page="page"
      v-model:page-size="pageSize"
      :total="total"
      @change="onPageChange"
    )
```

## 建議的封裝時機

當某種「篩選欄位 + 下拉 + 預設值處理」組合在 3 個以上頁面重複出現時，建議抽成元件放入 `app/components/`（遵循 `<Name>.vue` / PascalCase 命名），並於相關知識庫與本檔同步補上。

## Dialog 模式

### 三種標準 Dialog

1. **Info Dialog** — 唯讀檢視
   - Footer：刪除、編輯、其他業務按鈕、關閉
2. **Edit Dialog** — 編輯模式
   - 所有欄位可編輯 + 表單驗證
   - Footer：取消、確定儲存
3. **Create Dialog** — 新增模式
   - 欄位為空或預設值
   - Footer：取消、確定新增

### Dialog 開啟方式

```typescript
// 使用 $open 系統
function ClickDetail(id: number) {
  $open.OnOpen('OpenDialogCustomerInfo', { id });
}

function ClickCreate() {
  $open.OnOpen('OpenDialogCustomerCreate');
}
```

> 元件放在 `app/components/open/dialog/` 或 `open/drawer/`；命名 `OpenDialog{業務}{Info|Edit|Create}.vue`。

## 權限控制

```pug
//- 按鈕級權限
ElButton(
  v-if="StoreSelf().HasRule('customer:create')"
  @click="ClickCreate"
) 新增

//- 或使用 v-show
ElButton(
  v-show="canEdit"
  @click="ClickEdit"
) 編輯
```

```typescript
// Script 中檢查權限
const canEdit = computed(() => StoreSelf().HasRule('customer:edit'));
```
