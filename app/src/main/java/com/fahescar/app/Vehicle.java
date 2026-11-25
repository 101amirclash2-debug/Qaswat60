package com.fahescar.app;

public final class Vehicle {
    public final long id;
    public final String name;
    public final String make;
    public final String model;
    public final int year;
    public final int mileage;
    public final String vin;

    public Vehicle(long id, String name, String make, String model, int year, int mileage, String vin) {
        this.id = id;
        this.name = name == null ? "" : name;
        this.make = make == null ? "" : make;
        this.model = model == null ? "" : model;
        this.year = year;
        this.mileage = mileage;
        this.vin = vin == null ? "" : vin;
    }

    public String displayName() {
        String label = (make + " " + model).trim();
        if (year > 0) label += " " + year;
        return name.isEmpty() ? label : name + (label.isEmpty() ? "" : " — " + label);
    }
}
