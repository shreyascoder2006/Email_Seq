import { Response, NextFunction } from 'express';
import { Template } from '../models/Template';
import { AuthenticatedRequest } from '../types';
import { sendSuccess } from '../utils/response';
import { AppError } from '../utils/AppError';
import { CreateTemplateSchema, UpdateTemplateSchema, IdParamSchema, PreviewTemplateSchema } from '../validators/template.validator';
import sanitizeHtml from 'sanitize-html';

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
    const { id } = IdParamSchema.parse(req.params);
    const template = await Template.findOne({ _id: id, user_id: req.user?.userId, is_archived: false });
    if (!template) throw new AppError('Template not found', 404);

    // Provide some mock contact data if not provided
    const defaultContact = {
      firstName: 'John',
      lastName: 'Doe',
      company: 'Acme Corp',
    };

    let html = template.body_html;
    let subject = template.subject;

    const regex = /{{\s*(\w+)(?:\|([^}]+))?\s*}}/g;
    
    const replacer = (match: string, p1: string, p2: string) => {
      const val = defaultContact[p1 as keyof typeof defaultContact];
      if (val) return val;
      if (p2) return p2.trim();
      return `[${p1}]`;
    };

    html = html.replace(regex, replacer);
    subject = subject.replace(regex, replacer);

    sendSuccess(res, { html, subject }, 'Preview generated');
  } catch (err) {
    next(err);
  }
};
