import { WatchTenantCollection as WatchTenantCollection_1d0591e3cf4f332c83a86da13a0de59a } from '@payloadcms/plugin-multi-tenant/client'
import { GrantScopesField as GrantScopesField_f72aa3c0d135b885b20d14c3fe6f775a } from '../../../admin/Grants/GrantScopesField'
import { TenantField as TenantField_1d0591e3cf4f332c83a86da13a0de59a } from '@payloadcms/plugin-multi-tenant/client'
import { ReviewStatusField as ReviewStatusField_078936fce220cbf8e528e3d7e8fc0dfa } from '../../../admin/SendForApproval/ReviewStatusField'
import { RscEntryLexicalCell as RscEntryLexicalCell_44fe37237e0ebf4470c9990d8cb7b07e } from '@payloadcms/richtext-lexical/rsc'
import { RscEntryLexicalField as RscEntryLexicalField_44fe37237e0ebf4470c9990d8cb7b07e } from '@payloadcms/richtext-lexical/rsc'
import { LexicalDiffComponent as LexicalDiffComponent_44fe37237e0ebf4470c9990d8cb7b07e } from '@payloadcms/richtext-lexical/rsc'
import { PasteNormalizerFeatureClient as PasteNormalizerFeatureClient_c780a4fdc8f664469a32205e3bf3201e } from '../../../admin/PasteNormalizer/feature.client'
import { FixedToolbarFeatureClient as FixedToolbarFeatureClient_e70f5e05f09f93e00b997edb1ef0c864 } from '@payloadcms/richtext-lexical/client'
import { OrderedListFeatureClient as OrderedListFeatureClient_e70f5e05f09f93e00b997edb1ef0c864 } from '@payloadcms/richtext-lexical/client'
import { UnorderedListFeatureClient as UnorderedListFeatureClient_e70f5e05f09f93e00b997edb1ef0c864 } from '@payloadcms/richtext-lexical/client'
import { LinkFeatureClient as LinkFeatureClient_e70f5e05f09f93e00b997edb1ef0c864 } from '@payloadcms/richtext-lexical/client'
import { BoldFeatureClient as BoldFeatureClient_e70f5e05f09f93e00b997edb1ef0c864 } from '@payloadcms/richtext-lexical/client'
import { ItalicFeatureClient as ItalicFeatureClient_e70f5e05f09f93e00b997edb1ef0c864 } from '@payloadcms/richtext-lexical/client'
import { HeadingFeatureClient as HeadingFeatureClient_e70f5e05f09f93e00b997edb1ef0c864 } from '@payloadcms/richtext-lexical/client'
import { ParagraphFeatureClient as ParagraphFeatureClient_e70f5e05f09f93e00b997edb1ef0c864 } from '@payloadcms/richtext-lexical/client'
import { PermalinkField as PermalinkField_f6814ebdf510877580b089f38a229b9a } from '../../../admin/Permalink/PermalinkField'
import { LinkedPageCell as LinkedPageCell_7356ccf667888eca398b067f1932d5a1 } from '../../../admin/LinkedPage/LinkedPageCell'
import { AssignTenantFieldTrigger as AssignTenantFieldTrigger_1d0591e3cf4f332c83a86da13a0de59a } from '@payloadcms/plugin-multi-tenant/client'
import { SendForApprovalButton as SendForApprovalButton_04ce333b331daae73b75fc6274c29e3a } from '../../../admin/SendForApproval/SendForApprovalButton'
import { SchoolSaveDraftButton as SchoolSaveDraftButton_cc7b83310c556ae98b1d66c9fab1fdc1 } from '../../../admin/SendForApproval/SchoolSaveDraftButton'
import { BoardsListView as BoardsListView_a022c7e66bfcc000431bd70c768a08d6 } from '../../../admin/Boards/BoardsListView'
import { GlobalViewRedirect as GlobalViewRedirect_d6d5f193a167989e2ee7d14202901e62 } from '@payloadcms/plugin-multi-tenant/rsc'
import { ApprovalsNavLink as ApprovalsNavLink_50736d5f53ca3024920ebd70347f12c2 } from '../../../admin/Approvals/ApprovalsNavLink'
import { WaitingBanner as WaitingBanner_e51af2c63d800fe378f9f84cfaf25672 } from '../../../admin/Approvals/WaitingBanner'
import { GrantsPanel as GrantsPanel_186d64a3916edf6aa31629c5b61e084c } from '../../../admin/Grants/GrantsPanel'
import { TenantSelector as TenantSelector_d6d5f193a167989e2ee7d14202901e62 } from '@payloadcms/plugin-multi-tenant/rsc'
import { A11yPatch as A11yPatch_f47d732b0bfe7e156f459bc74057afca } from '../../../admin/A11yPatch/A11yPatch'
import { TenantSelectionProvider as TenantSelectionProvider_d6d5f193a167989e2ee7d14202901e62 } from '@payloadcms/plugin-multi-tenant/rsc'
import { SchoolHome as SchoolHome_3f48be60e82e2641c0b863afd982fe58 } from '../../../admin/SchoolPlane/SchoolHome'
import { UpdatePageView as UpdatePageView_0f1d98940f2489de43ebc550e3e4a561 } from '../../../admin/SchoolPlane/UpdatePageView'
import { NewPageView as NewPageView_75d5b0676850069cc52fd8659e0483db } from '../../../admin/SchoolPlane/NewPageView'
import { NewPostView as NewPostView_77e93fa34962fc9debb861b64f9a1c69 } from '../../../admin/SchoolPlane/NewPostView'
import { ApprovalsView as ApprovalsView_24670674c7de4661a804a1c4ad51ba6b } from '../../../admin/Approvals/ApprovalsView'
import { CollectionCards as CollectionCards_f9c02e79a4aed9a3924487c0cd4cafb1 } from '@payloadcms/next/rsc'

/** @type import('payload').ImportMap */
export const importMap = {
  "@payloadcms/plugin-multi-tenant/client#WatchTenantCollection": WatchTenantCollection_1d0591e3cf4f332c83a86da13a0de59a,
  "/admin/Grants/GrantScopesField#GrantScopesField": GrantScopesField_f72aa3c0d135b885b20d14c3fe6f775a,
  "@payloadcms/plugin-multi-tenant/client#TenantField": TenantField_1d0591e3cf4f332c83a86da13a0de59a,
  "/admin/SendForApproval/ReviewStatusField#ReviewStatusField": ReviewStatusField_078936fce220cbf8e528e3d7e8fc0dfa,
  "@payloadcms/richtext-lexical/rsc#RscEntryLexicalCell": RscEntryLexicalCell_44fe37237e0ebf4470c9990d8cb7b07e,
  "@payloadcms/richtext-lexical/rsc#RscEntryLexicalField": RscEntryLexicalField_44fe37237e0ebf4470c9990d8cb7b07e,
  "@payloadcms/richtext-lexical/rsc#LexicalDiffComponent": LexicalDiffComponent_44fe37237e0ebf4470c9990d8cb7b07e,
  "/admin/PasteNormalizer/feature.client#PasteNormalizerFeatureClient": PasteNormalizerFeatureClient_c780a4fdc8f664469a32205e3bf3201e,
  "@payloadcms/richtext-lexical/client#FixedToolbarFeatureClient": FixedToolbarFeatureClient_e70f5e05f09f93e00b997edb1ef0c864,
  "@payloadcms/richtext-lexical/client#OrderedListFeatureClient": OrderedListFeatureClient_e70f5e05f09f93e00b997edb1ef0c864,
  "@payloadcms/richtext-lexical/client#UnorderedListFeatureClient": UnorderedListFeatureClient_e70f5e05f09f93e00b997edb1ef0c864,
  "@payloadcms/richtext-lexical/client#LinkFeatureClient": LinkFeatureClient_e70f5e05f09f93e00b997edb1ef0c864,
  "@payloadcms/richtext-lexical/client#BoldFeatureClient": BoldFeatureClient_e70f5e05f09f93e00b997edb1ef0c864,
  "@payloadcms/richtext-lexical/client#ItalicFeatureClient": ItalicFeatureClient_e70f5e05f09f93e00b997edb1ef0c864,
  "@payloadcms/richtext-lexical/client#HeadingFeatureClient": HeadingFeatureClient_e70f5e05f09f93e00b997edb1ef0c864,
  "@payloadcms/richtext-lexical/client#ParagraphFeatureClient": ParagraphFeatureClient_e70f5e05f09f93e00b997edb1ef0c864,
  "/admin/Permalink/PermalinkField#PermalinkField": PermalinkField_f6814ebdf510877580b089f38a229b9a,
  "/admin/LinkedPage/LinkedPageCell#LinkedPageCell": LinkedPageCell_7356ccf667888eca398b067f1932d5a1,
  "@payloadcms/plugin-multi-tenant/client#AssignTenantFieldTrigger": AssignTenantFieldTrigger_1d0591e3cf4f332c83a86da13a0de59a,
  "/admin/SendForApproval/SendForApprovalButton#SendForApprovalButton": SendForApprovalButton_04ce333b331daae73b75fc6274c29e3a,
  "/admin/SendForApproval/SchoolSaveDraftButton#SchoolSaveDraftButton": SchoolSaveDraftButton_cc7b83310c556ae98b1d66c9fab1fdc1,
  "/admin/Boards/BoardsListView#BoardsListView": BoardsListView_a022c7e66bfcc000431bd70c768a08d6,
  "@payloadcms/plugin-multi-tenant/rsc#GlobalViewRedirect": GlobalViewRedirect_d6d5f193a167989e2ee7d14202901e62,
  "/admin/Approvals/ApprovalsNavLink#ApprovalsNavLink": ApprovalsNavLink_50736d5f53ca3024920ebd70347f12c2,
  "/admin/Approvals/WaitingBanner#WaitingBanner": WaitingBanner_e51af2c63d800fe378f9f84cfaf25672,
  "/admin/Grants/GrantsPanel#GrantsPanel": GrantsPanel_186d64a3916edf6aa31629c5b61e084c,
  "@payloadcms/plugin-multi-tenant/rsc#TenantSelector": TenantSelector_d6d5f193a167989e2ee7d14202901e62,
  "/admin/A11yPatch/A11yPatch#A11yPatch": A11yPatch_f47d732b0bfe7e156f459bc74057afca,
  "@payloadcms/plugin-multi-tenant/rsc#TenantSelectionProvider": TenantSelectionProvider_d6d5f193a167989e2ee7d14202901e62,
  "/admin/SchoolPlane/SchoolHome#SchoolHome": SchoolHome_3f48be60e82e2641c0b863afd982fe58,
  "/admin/SchoolPlane/UpdatePageView#UpdatePageView": UpdatePageView_0f1d98940f2489de43ebc550e3e4a561,
  "/admin/SchoolPlane/NewPageView#NewPageView": NewPageView_75d5b0676850069cc52fd8659e0483db,
  "/admin/SchoolPlane/NewPostView#NewPostView": NewPostView_77e93fa34962fc9debb861b64f9a1c69,
  "/admin/Approvals/ApprovalsView#ApprovalsView": ApprovalsView_24670674c7de4661a804a1c4ad51ba6b,
  "@payloadcms/next/rsc#CollectionCards": CollectionCards_f9c02e79a4aed9a3924487c0cd4cafb1
}
