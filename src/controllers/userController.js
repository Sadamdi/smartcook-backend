const User = require("../models/User");

const getProfile = async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: req.user,
    });
  } catch (error) {
    next(error);
  }
};

const updateProfile = async (req, res, next) => {
  try {
    const allowedFields = ["name", "age_range", "gender"];
    const updates = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    const user = await User.findByIdAndUpdate(req.user._id, updates, {
      new: true,
      runValidators: true,
    });

    res.json({
      success: true,
      message: "Profil berhasil diupdate.",
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

const saveOnboarding = async (req, res, next) => {
  try {
    const {
      name,
      age_range,
      gender,
      allergies,
      medical_history,
      cooking_styles,
      equipment,
    } = req.body;

    const updates = { onboarding_completed: true };

    if (name !== undefined) updates.name = name;
    if (age_range !== undefined) updates.age_range = age_range;
    if (gender !== undefined) updates.gender = gender;
    if (allergies !== undefined) updates.allergies = allergies;
    if (medical_history !== undefined) updates.medical_history = medical_history;
    if (cooking_styles !== undefined) updates.cooking_styles = cooking_styles;
    if (equipment !== undefined) updates.equipment = equipment;

    const user = await User.findByIdAndUpdate(req.user._id, updates, {
      new: true,
      runValidators: true,
    });

    res.json({
      success: true,
      message: "Data onboarding berhasil disimpan.",
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getProfile, updateProfile, saveOnboarding };
