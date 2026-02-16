const Ingredient = require("../models/Ingredient");

const COOKING_STYLES = [
  { id: "quick_easy", name: "Quick & Easy", description: "Masakan cepat dan mudah" },
  { id: "healthy_clean", name: "Healthy & Clean", description: "Masakan sehat dan bersih" },
  { id: "budget_friendly", name: "Budget Friendly", description: "Masakan hemat budget" },
  { id: "traditional", name: "Traditional", description: "Masakan tradisional Indonesia" },
  { id: "modern", name: "Modern", description: "Masakan modern dan kekinian" },
  { id: "vegetarian", name: "Vegetarian", description: "Masakan vegetarian" },
];

const MEAL_TYPES = [
  { id: "breakfast", name: "Breakfast", description: "Sarapan pagi" },
  { id: "lunch", name: "Lunch", description: "Makan siang" },
  { id: "dinner", name: "Dinner", description: "Makan malam" },
];

const INGREDIENT_CATEGORIES = [
  { id: "protein", name: "Protein", icon: "protein" },
  { id: "karbo", name: "Karbo", icon: "karbo" },
  { id: "sayur", name: "Sayur", icon: "sayur" },
  { id: "bumbu", name: "Bumbu", icon: "bumbu" },
];

const getCookingStyles = async (req, res, next) => {
  try {
    res.json({ success: true, data: COOKING_STYLES });
  } catch (error) {
    next(error);
  }
};

const getMealTypes = async (req, res, next) => {
  try {
    res.json({ success: true, data: MEAL_TYPES });
  } catch (error) {
    next(error);
  }
};

const getIngredients = async (req, res, next) => {
  try {
    const { category } = req.query;
    const query = {};

    if (category) {
      const validCategories = ["protein", "karbo", "sayur", "bumbu"];
      if (!validCategories.includes(category)) {
        return res.status(400).json({ success: false, message: "Kategori tidak valid." });
      }
      query.category = category;
    }

    const ingredients = await Ingredient.find(query).sort({ category: 1, name: 1 });

    const grouped = {};
    for (const ing of ingredients) {
      if (!grouped[ing.category]) {
        grouped[ing.category] = [];
      }
      grouped[ing.category].push(ing);
    }

    res.json({
      success: true,
      data: {
        categories: INGREDIENT_CATEGORIES,
        ingredients: category ? ingredients : grouped,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getCookingStyles, getMealTypes, getIngredients };
