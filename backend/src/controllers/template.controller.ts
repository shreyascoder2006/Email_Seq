import { Response, NextFunction } from 'express';
import { Template } from '../models/Template';
import { AuthenticatedRequest } from '../types';
import { sendSuccess } from '../utils/response';
import { AppError } from '../utils/AppError';
import { CreateTemplateSchema, UpdateTemplateSchema, IdParamSchema, PreviewTemplateSchema } from '../validators/template.validator';
import sanitizeHtml from 'sanitize-html';
import { ImportList } from '../models/ImportList';
import { CustomField } from '../models/CustomField';
import { z } from 'zod';
import { STANDARD_CONTACT_TAGS, STANDARD_SENDER_TAGS, STANDARD_SEQUENCE_TAGS } from '../utils/mergeTags.registry';

const extractVariables = (html: string) => {
  const regex = /{{\s*(\w+)(?:\|([^}]+))?\s*}}/g;
  const variables = [];
  let match;
  const seen = new Set<string>();

  while ((match = regex.exec(html)) !== null) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      variables.push({
        name,
        label: name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, ' '),
        default_value: match[2] ? match[2].trim() : '',
        required: !match[2],
      });
    }
  }
  return variables;
};

export const listTemplates = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const templates = await Template.find({ user_id: userId, is_archived: false })
      .sort({ updated_at: -1 })
      .lean();
    sendSuccess(res, templates, 'Templates retrieved');
  } catch (err) {
    next(err);
  }
};

export const getMergeTags = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.userId;
    
    const contact = STANDARD_CONTACT_TAGS.map(t => ({ tag: t.tag, label: t.label, desc: t.desc }));
    const sender = STANDARD_SENDER_TAGS.map(t => ({ tag: t.tag, label: t.label, desc: t.desc }));
    const sequence = STANDARD_SEQUENCE_TAGS.map(t => ({ tag: t.tag, label: t.label, desc: t.desc }));

    // Aggregate custom fields from the user's import lists
    const importLists = await ImportList.find({ user_id: userId }).lean();
    const customSet = new Set<string>();
    
    for (const list of importLists) {
      for (const mapping of list.field_mappings) {
        if (!mapping.is_system) {
          customSet.add(mapping.system_field);
        }
      }
    }

    // Combine with global custom fields
    const globalCustomFields = await CustomField.find({ user_id: userId }).lean();
    for (const cf of globalCustomFields) {
      customSet.add(cf.key);
    }

    const custom = Array.from(customSet).map(field => {
      // Use label from CustomField if it exists, otherwise generate one
      const cf = globalCustomFields.find(c => c.key === field);
      return {
        tag: `{{${field}}}`,
        label: cf ? cf.label : field.charAt(0).toUpperCase() + field.slice(1).replace(/_/g, ' '),
        desc: `Custom field: ${field}`
      };
    });

    sendSuccess(res, { contact, custom, sender, sequence }, 'Merge tags retrieved');
  } catch (err) {
    next(err);
  }
};

const CreateCustomFieldSchema = z.object({
  key: z.string().trim().toLowerCase().regex(/^[a-z0-9_]+$/, 'Only lowercase letters, numbers, and underscores allowed'),
  label: z.string().trim().min(1, 'Label is required'),
});

export const createCustomMergeTag = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = CreateCustomFieldSchema.parse(req.body);
    const userId = req.user?.userId;

    const existing = await CustomField.findOne({ user_id: userId, key: data.key });
    if (existing) {
      throw new AppError('A custom field with this key already exists.', 400);
    }

    const newField = await CustomField.create({
      user_id: userId,
      key: data.key,
      label: data.label,
    });

    sendSuccess(res, newField, 'Custom field created successfully', 201);
  } catch (err) {
    next(err);
  }
};

export const getTemplate = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = IdParamSchema.parse(req.params);
    const template = await Template.findOne({ _id: id, user_id: req.user?.userId, is_archived: false }).lean();
    if (!template) throw new AppError('Template not found', 404);
    sendSuccess(res, template, 'Template retrieved');
  } catch (err) {
    next(err);
  }
};

export const createTemplate = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = CreateTemplateSchema.parse(req.body);
    const cleanHtml = sanitizeHtml(data.body_html, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
      allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, '*': ['style', 'class'] },
    });
    
    const variables = extractVariables(cleanHtml);

    const template = await Template.create({
      user_id: req.user?.userId,
      ...data,
      body_html: cleanHtml,
      variables,
    });

    sendSuccess(res, template, 'Template created successfully', 201);
  } catch (err) {
    next(err);
  }
};

export const updateTemplate = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = IdParamSchema.parse(req.params);
    const data = UpdateTemplateSchema.parse(req.body);

    const template = await Template.findOne({ _id: id, user_id: req.user?.userId, is_archived: false });
    if (!template) throw new AppError('Template not found', 404);

    if (data.name !== undefined) template.name = data.name;
    if (data.subject !== undefined) template.subject = data.subject;
    if (data.category !== undefined) template.category = data.category as any;
    
    if (data.body_html !== undefined) {
      const cleanHtml = sanitizeHtml(data.body_html, {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
        allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, '*': ['style', 'class'] },
      });
      template.body_html = cleanHtml;
      template.variables = extractVariables(cleanHtml);
    }

    await template.save();
    sendSuccess(res, template, 'Template updated successfully');
  } catch (err) {
    next(err);
  }
};

export const deleteTemplate = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = IdParamSchema.parse(req.params);
    const template = await Template.findOne({ _id: id, user_id: req.user?.userId, is_archived: false });
    if (!template) throw new AppError('Template not found', 404);

    template.is_archived = true;
    await template.save();
    sendSuccess(res, null, 'Template deleted successfully');
  } catch (err) {
    next(err);
  }
};

export const previewTemplate = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    
    // We can preview an existing template by ID or raw HTML/Subject sent in body
    let html = req.body.html || '';
    let subject = req.body.subject || '';

    if (id && id !== 'raw') {
      const template = await Template.findOne({ _id: id, user_id: req.user?.userId, is_archived: false });
      if (!template) throw new AppError('Template not found', 404);
      html = html || template.body_html;
      subject = subject || template.subject;
    }

    // Dummy contact data
    const dummyCtx = {
      first_name: 'John',
      last_name: 'Doe',
      email: 'john.doe@example.com',
      company: 'Acme Corp',
      custom_variables: {
        favorite_product: 'EmailSequencer Pro',
        industry: 'Software',
      }
    };

    // Replace basic tags
    const regex = /{{\s*([a-zA-Z0-9_]+)\s*}}/g;
    
    const replacer = (match: string, p1: string) => {
      const key = p1.toLowerCase();
      if (key in dummyCtx) return dummyCtx[key as keyof typeof dummyCtx] as string;
      if (key in dummyCtx.custom_variables) return dummyCtx.custom_variables[key as keyof typeof dummyCtx.custom_variables];
      return `[${p1}]`;
    };

    html = html.replace(regex, replacer);
    subject = subject.replace(regex, replacer);

    sendSuccess(res, { html, subject }, 'Preview generated');
  } catch (err) {
    next(err);
  }
};
