import { Router } from 'express';
import { 
  listTemplates, 
  getTemplate, 
  createTemplate, 
  updateTemplate, 
  deleteTemplate, 
  previewTemplate,
  getMergeTags,
  createCustomMergeTag
} from '../controllers/template.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/merge-tags', getMergeTags);
router.post('/merge-tags/custom', createCustomMergeTag);
router.get('/', listTemplates);
router.post('/', createTemplate);
router.get('/:id', getTemplate);
router.put('/:id', updateTemplate);
router.delete('/:id', deleteTemplate);
router.post('/:id/preview', previewTemplate);

export default router;
